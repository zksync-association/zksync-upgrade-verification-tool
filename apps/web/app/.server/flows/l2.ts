import { guardiansAbi, l1MessengerEventAbi, l2GovernorAbi, upgradeHandlerAbi } from "@/common/abis";
import type { L2Proposal } from "@/common/execution";
import {
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  decodeEventLog,
  encodeAbiParameters,
  getAddress,
  isAddressEqual,
  isHex,
  keccak256,
  numberToHex,
  toHex,
} from "viem";
import { getLogProof } from "viem/zksync";
import { FOREVER, cached } from "../cache";
import {
  type L2GovernorEvent,
  eventsInWindow,
  eventsInWindowAnswer,
  isIndexedL2Governor,
  l2GovernorIndex,
  l2IndexHead,
} from "../chain/l2-index";
import { governance } from "../governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import { type L2Head, l1, l2, network, refreshL2ChainHead } from "../rpc";
import { callTo, topicOf } from "./common";
import { L1_MESSENGER, findL2ProposalInBatch, upgradeBatch } from "./l2-batch";

// ZKsync Era side of governance: the governors Guardians can veto, and the protocol governor whose
// executed proposals start L1 upgrades. The pinned governors' ProposalCreated, ProposalExecuted
// and ProposalCanceled logs come from the L2 governor log index (chain/l2-index.ts), and windows
// ("the last 24 days") are cut by the timestamp of each event's block. A governor replaced through
// env, and every governor while Era does not know the 'finalized' tag (see l2IndexHead), is
// scanned on demand, as before: a timestamp search for the window's first block, then the
// window's logs. Results near the head are never cached for good.

const DAY = 86_400n;
// 3-day voting delay + 7-day voting period + 7-day possible extension, with margin.
const VETO_WINDOW = 24n * DAY;
// Executed protocol proposals whose L1 upgrade may still be started.
const STARTABLE_WINDOW = 30n * DAY;
// An upgrade's L2 execution, before its L1 creation (legacy discovery).
const DISCOVERY_WINDOW = 21n * DAY;
// A proposal's state() read at an Era head is served while that head is (4 s).
const STATE_TTL_MS = 4_000;

// IGovernor.ProposalState
export const L2_PROPOSAL_STATES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
] as const;
export type L2ProposalStateName = (typeof L2_PROPOSAL_STATES)[number];

export type L2GovernorKind = "token" | "govOps" | "protocol";

export async function knownGovernors(): Promise<
  { kind: L2GovernorKind; name: string; address: Address }[]
> {
  const { l2Governors } = await network();
  return [
    { kind: "token" as const, name: "ZkTokenGovernor", address: l2Governors.token },
    { kind: "govOps" as const, name: "ZkGovOpsGovernor", address: l2Governors.govOps },
    { kind: "protocol" as const, name: "ZkProtocolGovernor", address: l2Governors.protocol },
  ].filter(
    (g): g is { kind: L2GovernorKind; name: string; address: Address } => g.address !== null
  );
}

// ---- governors that are not indexed: on-demand scans ----

async function l2Head(client: PublicClient) {
  return cached("l2-head", 4_000, () => client.getBlock({ blockTag: "latest" }));
}

async function l2BlockAt(client: PublicClient, timestamp: bigint) {
  const head = await l2Head(client);
  if (timestamp >= head.timestamp) return head.number;
  return findBlockByTimestamp(client, timestamp, 1n, head.number, {
    key: "l2",
    safeHead: head.number - 1_000n,
  });
}

/** `name` logs of `governor` in [from block, head] (scanned on demand, never cached). */
async function scanWindow(
  client: PublicClient,
  governor: Address,
  name: "ProposalCreated" | "ProposalExecuted",
  since: bigint
) {
  const head = await l2Head(client);
  const from = await l2BlockAt(client, head.timestamp - since);
  return getLogs(
    client,
    { address: governor, topics: [topicOf(l2GovernorAbi, name)] },
    from,
    head.number,
    { safeHead: -1n }
  );
}

// ---- proposals ----

export type L2ProposalView = L2Proposal & {
  governor: Address;
  governorName: string | null;
  proposalId: string;
  proposer: Address;
  state: L2ProposalStateName | null;
  voteStart: string;
  voteEnd: string;
  // hashL2Proposal recomputed locally and by Guardians.hashL2Proposal on L1; both must equal the id.
  idMatchesLocal: boolean;
  idMatchesContract: boolean | null;
  createdTx: Hex;
};

function hashL2Proposal(p: L2Proposal): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [p.targets, p.values.map(BigInt), p.calldatas, keccak256(toHex(p.description))]
      )
    )
  );
}

type CreatedLog = Pick<Log, "data" | "topics" | "transactionHash" | "blockHash" | "logIndex">;

/** What a ProposalCreated log says: everything about a proposal except its current state. */
type Created = {
  proposal: L2Proposal;
  proposalId: bigint;
  proposer: Address;
  voteStart: bigint;
  voteEnd: bigint;
  /** hashL2Proposal(proposal), computed here. */
  localId: bigint;
  createdTx: Hex;
};

function decodeCreated(log: CreatedLog): Created {
  const { args } = decodeEventLog({
    abi: l2GovernorAbi,
    eventName: "ProposalCreated",
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
  });
  const proposal: L2Proposal = {
    targets: args.targets.map((t) => getAddress(t)),
    values: args.values.map((v) => v.toString()),
    calldatas: [...args.calldatas],
    description: args.description,
  };
  return {
    proposal,
    proposalId: args.proposalId,
    proposer: getAddress(args.proposer),
    voteStart: args.voteStart,
    voteEnd: args.voteEnd,
    localId: hashL2Proposal(proposal),
    createdTx: log.transactionHash as Hex,
  };
}

/** decodeCreated, once per log: a block hash and a log index name one log for good. */
function createdOf(log: CreatedLog): Promise<Created> {
  if (!isHex(log.blockHash) || typeof log.logIndex !== "number")
    return Promise.resolve(decodeCreated(log));
  return cached(`l2-created:${log.blockHash.toLowerCase()}:${log.logIndex}`, FOREVER, async () =>
    decodeCreated(log)
  );
}

/**
 * Guardians.hashL2Proposal on L1 for this content (a pure function of it): kept once read. null
 * when the read failed (asked again next time).
 */
async function idOnL1(created: Created): Promise<bigint | null> {
  try {
    const { guardians } = await governance();
    return await cached(`l2-id-on-l1:${guardians.address}:${created.localId}`, FOREVER, () =>
      l1.readContract({
        address: guardians.address,
        abi: guardiansAbi,
        functionName: "hashL2Proposal",
        args: [
          {
            targets: created.proposal.targets,
            values: created.proposal.values.map(BigInt),
            calldatas: created.proposal.calldatas,
            description: created.proposal.description,
          },
        ],
      })
    );
  } catch {
    return null;
  }
}

/**
 * The proposal a ProposalCreated log of `governor` describes, with its state read now. `at`: the
 * Era head the request answers at; the state read is then shared by requests at that head.
 * `fromLastRun`: the log comes from the history the last run saved, not read in this run yet; what
 * it says is decoded for this answer only, never kept for the log at that place.
 */
async function viewOf(
  client: PublicClient,
  governor: Address,
  log: CreatedLog,
  at: L2Head | null,
  { fromLastRun = false }: { fromLastRun?: boolean } = {}
): Promise<L2ProposalView> {
  const created = fromLastRun ? decodeCreated(log) : await createdOf(log);
  const readState = () =>
    client
      .readContract({
        address: governor,
        abi: l2GovernorAbi,
        functionName: "state",
        args: [created.proposalId],
      })
      // null only for a value outside IGovernor.ProposalState. A failed read fails the caller,
      // whatever its kind: a proposal whose state went unread must neither drop out of what
      // Guardians can veto nor close its veto. (viem turns Era's code-3 revert and an internal
      // error -32603 into the same ContractFunctionRevertedError, so no failure here is an answer.)
      .then((s) => L2_PROPOSAL_STATES[s] ?? null);
  const [state, governorName, contractId] = await Promise.all([
    at
      ? cached(
          `l2-state:${governor.toLowerCase()}:${created.proposalId}:${at.head.hash}`,
          STATE_TTL_MS,
          readState
        )
      : readState(),
    knownGovernors().then(
      (gs) => gs.find((g) => isAddressEqual(g.address, governor))?.name ?? null
    ),
    idOnL1(created),
  ]);
  return {
    ...created.proposal,
    governor,
    governorName,
    proposalId: created.proposalId.toString(),
    proposer: created.proposer,
    state,
    voteStart: created.voteStart.toString(),
    voteEnd: created.voteEnd.toString(),
    idMatchesLocal: created.localId === created.proposalId,
    idMatchesContract: contractId === null ? null : contractId === created.proposalId,
    createdTx: created.createdTx,
  };
}

const proposalKey = (governor: Address, id: bigint) => `${governor.toLowerCase()}:${id}`;

const isVetoable = (p: L2ProposalView) =>
  p.state === null || p.state === "Pending" || p.state === "Active";

/** Vetoable proposals, and whether part of them came from the history the last run saved. */
export type VetoableAnswer = { proposals: L2ProposalView[]; provisional: boolean };

/**
 * Indexed governors' proposals created in the last 24 days, except those the index shows
 * executed or canceled (final states: their state() would only confirm it), at Era head `at`.
 * `provisional` (pages only): the index may answer from the history the last run saved, and the
 * window from the block times it saved, while this run reads them again (the answer says so);
 * states are always read at `at`.
 */
async function recentFromIndex(
  client: PublicClient,
  governors: readonly Address[],
  at: L2Head,
  provisional = false
): Promise<VetoableAnswer> {
  const read = await l2GovernorIndex().read({ head: at, provisional });
  const { head, events } = read;
  const closed = new Set(
    events
      .filter((e) => e.eventName !== "ProposalCreated")
      .map((e) => proposalKey(e.governor, e.proposalId))
  );
  const created = events.filter(
    (e) =>
      e.eventName === "ProposalCreated" &&
      governors.some((g) => isAddressEqual(g, e.governor)) &&
      !closed.has(proposalKey(e.governor, e.proposalId))
  );
  const since = head.head.timestamp - VETO_WINDOW;
  const recent = provisional
    ? await eventsInWindowAnswer(created, since)
    : { events: await eventsInWindow(created, since), provisional: false };
  const proposals = await Promise.all(
    recent.events.map((e) => {
      const governor = governors.find((g) => isAddressEqual(g, e.governor)) ?? e.governor;
      return viewOf(client, governor, e.log, head, { fromLastRun: e.provisional });
    })
  );
  return { proposals, provisional: read.provisional || recent.provisional };
}

/** A replaced governor's proposals created in the last 24 days (scanned on demand). */
async function recentFromScan(client: PublicClient, governor: Address): Promise<L2ProposalView[]> {
  const logs = await scanWindow(client, governor, "ProposalCreated", VETO_WINDOW);
  return Promise.all(logs.map((log) => viewOf(client, governor, log, null)));
}

// When the vetoable proposals (or a veto's proposal) were last asked for, for the sync engine.
let vetoInterestAt: number | null = null;
const VETO_INTEREST_MS = 10 * 60_000;

/**
 * Proposals on the Token and GovOps governors that Guardians can still veto (Pending or Active,
 * or a state value the app does not know: listed rather than hidden). A failed read fails the list.
 */
export async function activeL2Proposals(): Promise<L2ProposalView[]> {
  return (await activeL2ProposalsAnswer()).proposals;
}

/**
 * activeL2Proposals, and whether the answer used the history the last run saved: with
 * `provisional` (a page's first answer), the indexed governors' events may come from it while this
 * run reads them again (see recentFromIndex); without it (JSON, and a page's fresh answer), never.
 */
export async function activeL2ProposalsAnswer({
  provisional = false,
}: { provisional?: boolean } = {}): Promise<VetoableAnswer> {
  vetoInterestAt = Date.now();
  const client = await l2();
  if (!client) return { proposals: [], provisional: false };
  const [net, all] = await Promise.all([network(), knownGovernors()]);
  const governors = all.filter((g) => g.kind !== "protocol");
  const at = governors.some((g) => isIndexedL2Governor(net, g.address))
    ? await l2IndexHead(net)
    : null;
  const indexed = at ? governors.filter((g) => isIndexedL2Governor(net, g.address)) : [];
  const [fromIndex, ...scanned] = await Promise.all([
    at && indexed.length > 0
      ? recentFromIndex(
          client,
          indexed.map((g) => g.address),
          at,
          provisional
        )
      : { proposals: [], provisional: false },
    ...governors.filter((g) => !indexed.includes(g)).map((g) => recentFromScan(client, g.address)),
  ]);
  const found = [...(fromIndex?.proposals ?? []), ...scanned.flat()];
  // Per governor, in the order above; each governor's oldest first.
  return {
    proposals: governors
      .flatMap((g) => found.filter((p) => isAddressEqual(p.governor, g.address)))
      .filter(isVetoable),
    provisional: fromIndex?.provisional ?? false,
  };
}

/**
 * For the sync engine, on a new L1 head: when vetoable proposals were asked for in the last 10
 * minutes, reads Era's head now, the governor index's tail at the Era head served then (this one,
 * unless a newer one is known) and those proposals' states, so requests in the next 4 s find them
 * in memory. False when they were not asked for lately, no vetoable governor is indexed, or Era
 * does not know the 'finalized' tag (requests then scan on demand).
 */
export async function refreshVetoableL2(): Promise<boolean> {
  if (vetoInterestAt === null || Date.now() - vetoInterestAt > VETO_INTEREST_MS) return false;
  const client = await l2();
  if (!client) return false;
  const [net, all] = await Promise.all([network(), knownGovernors()]);
  const indexed = all.filter((g) => g.kind !== "protocol" && isIndexedL2Governor(net, g.address));
  if (indexed.length === 0) return false;
  if (!(await refreshL2ChainHead())) return false;
  const at = await l2IndexHead(net);
  if (!at) return false;
  await recentFromIndex(
    client,
    indexed.map((g) => g.address),
    at
  );
  return true;
}

/** A specific L2 proposal's content, from its ProposalCreated log, with its state read now. */
export async function getL2Proposal(
  governor: Address,
  proposalId: bigint
): Promise<L2ProposalView | null> {
  vetoInterestAt = Date.now();
  const client = await l2();
  if (!client) return null;
  const net = await network();
  const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net) : null;
  if (at) {
    // The index holds every ProposalCreated of this governor up to the head: none for this id
    // means the governor has no such proposal.
    const { head, events } = await l2GovernorIndex().read({ head: at });
    const event = events.find(
      (e) =>
        e.eventName === "ProposalCreated" &&
        isAddressEqual(e.governor, governor) &&
        e.proposalId === proposalId
    );
    return event ? viewOf(client, governor, event.log, head) : null;
  }
  // A replaced governor (or Era without the 'finalized' tag): found from its on-chain snapshot
  // time.
  return cached(`l2-proposal:${governor}:${proposalId}`, 5 * 60_000, async () => {
    const [snapshot, votingDelay] = await Promise.all([
      client.readContract({
        address: governor,
        abi: l2GovernorAbi,
        functionName: "proposalSnapshot",
        args: [proposalId],
      }),
      client.readContract({ address: governor, abi: l2GovernorAbi, functionName: "votingDelay" }),
    ]);
    if (snapshot === 0n) return null;
    // Created at snapshot - votingDelay, unless the delay changed since; widen the window for that.
    const from = await l2BlockAt(client, snapshot - votingDelay - 7n * DAY);
    const to = await l2BlockAt(client, snapshot);
    const logs = await getLogs(
      client,
      { address: governor, topics: [topicOf(l2GovernorAbi, "ProposalCreated")] },
      from,
      to,
      { safeHead: -1n }
    );
    // Only the matching proposal is read further: another proposal's failed state() read must
    // not fail this one.
    const log = logs.find(
      (l) =>
        decodeEventLog({
          abi: l2GovernorAbi,
          eventName: "ProposalCreated",
          data: l.data,
          topics: l.topics,
        }).args.proposalId === proposalId
    );
    return log ? viewOf(client, governor, log, null) : null;
  });
}

/**
 * The protocol governor's ProposalExecuted events in blocks timed [since, until] from the index,
 * at Era head `at`.
 */
async function executedFromIndex(
  governor: Address,
  at: L2Head,
  since: bigint,
  until?: bigint
): Promise<L2GovernorEvent[]> {
  const { events } = await l2GovernorIndex().read({ head: at });
  const executed = events.filter(
    (e) => e.eventName === "ProposalExecuted" && isAddressEqual(e.governor, governor)
  );
  return eventsInWindow(executed, since, until);
}

/** ZkProtocolGovernor proposal whose L2 → L1 message is the upgrade `l1Id` (for the Tally link). */
export async function findL2ProposalForUpgrade(
  l1Id: Hex,
  creationTimestamp: number,
  { startedTxHash, strategy = "batch" }: { startedTxHash?: Hex; strategy?: "batch" | "legacy" } = {}
) {
  const client = await l2();
  const net = await network();
  const { l2Governors, isDevNode, upgradeHandler } = net;
  if (!client || !l2Governors.protocol) return null;
  const governor = l2Governors.protocol;
  return cached(
    `l2-for-upgrade:${strategy}:${l1Id}`,
    isDevNode ? 0 : Number.POSITIVE_INFINITY,
    async () => {
      if (strategy === "batch" && startedTxHash) {
        try {
          const call = await callTo(startedTxHash, upgradeHandler);
          const batch = call ? upgradeBatch(call.data, l1Id) : null;
          if (batch !== null) {
            const match = await findL2ProposalInBatch(client, l1Id, governor, batch);
            if (match) return match;
          }
        } catch {
          // Unsupported RPC methods or unavailable batch history retain the existing discovery path.
        }
      }
      const created = BigInt(creationTimestamp);
      // Executions in the 21 days before the upgrade's creation on L1. (Its own execution was
      // proven on L1 before then, so it is in a block timed before the creation.)
      const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net) : null;
      const logs: { log: Log; final: boolean }[] = at
        ? await executedFromIndex(governor, at, created - DISCOVERY_WINDOW, created)
        : await windowLogs(client, governor, created);
      for (const { log, final } of logs) {
        const message = await l1MessageOf(client, log.transactionHash as Hex, final);
        if (message && keccak256(message.body) === l1Id) {
          const { args } = decodeEventLog({
            abi: l2GovernorAbi,
            eventName: "ProposalExecuted",
            data: log.data,
            topics: log.topics,
          });
          return {
            governor,
            proposalId: args.proposalId.toString(),
            executedTx: log.transactionHash as Hex,
          };
        }
      }
      return null;
    }
  );
}

/** A replaced protocol governor's executions in [created − 21 days, created], scanned on demand. */
async function windowLogs(client: PublicClient, governor: Address, created: bigint) {
  const from = await l2BlockAt(client, created - DISCOVERY_WINDOW);
  const to = await l2BlockAt(client, created);
  const logs = await getLogs(
    client,
    { address: governor, topics: [topicOf(l2GovernorAbi, "ProposalExecuted")] },
    from,
    to,
    { safeHead: -1n }
  );
  return logs.map((log) => ({ log, final: false }));
}

/**
 * The L2 → L1 message an execution sent, from its receipt. Kept for good when the execution is
 * final (at or below Era's 'finalized' block): its receipt never changes.
 */
function l1MessageOf(client: PublicClient, txHash: Hex, final = false) {
  return final
    ? cached(`l2-message:${txHash.toLowerCase()}`, FOREVER, () => readL1Message(client, txHash))
    : readL1Message(client, txHash);
}

async function readL1Message(client: PublicClient, txHash: Hex) {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const log = receipt.logs.find(
    (l) =>
      isAddressEqual(l.address, L1_MESSENGER) &&
      l.topics[0] === topicOf(l1MessengerEventAbi, "L1MessageSent")
  );
  if (!log) return null;
  const { args } = decodeEventLog({ abi: l1MessengerEventAbi, data: log.data, topics: log.topics });
  return { body: args._message, receipt };
}

export type NotStartedUpgrade = {
  l2ProposalId: Hex;
  executedTx: Hex;
} & (
  | {
      ok: true;
      l1ProposalId: Hex;
      data: {
        l2BatchNumber: Hex;
        l2MessageIndex: Hex;
        l2TxNumberInBatch: Hex | null;
        proof: Hex[];
        proposal: Hex;
      };
    }
  | { ok: false; error: string }
);

/** Executed ZkProtocolGovernor proposals whose L1 upgrade has not been started yet. */
export async function notStartedUpgrades(): Promise<NotStartedUpgrade[]> {
  const client = await l2();
  const net = await network();
  if (!client || !net.l2Governors.protocol) return [];
  const governor = net.l2Governors.protocol;
  const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net) : null;
  const logs: { log: Log; final: boolean }[] = at
    ? await executedFromIndex(governor, at, at.head.timestamp - STARTABLE_WINDOW)
    : (await scanWindow(client, governor, "ProposalExecuted", STARTABLE_WINDOW)).map((log) => ({
        log,
        final: false,
      }));
  const results = await Promise.all(
    logs.map(async ({ log, final }): Promise<NotStartedUpgrade | null> => {
      const { args } = decodeEventLog({
        abi: l2GovernorAbi,
        eventName: "ProposalExecuted",
        data: log.data,
        topics: log.topics,
      });
      const l2ProposalId = numberToHex(args.proposalId);
      const executedTx = log.transactionHash as Hex;
      const message = await l1MessageOf(client, executedTx, final);
      if (!message)
        return {
          l2ProposalId,
          executedTx,
          ok: false,
          error: "No L2 → L1 message in the execution",
        };
      const l1ProposalId = keccak256(message.body);
      const state = await l1.readContract({
        address: net.upgradeHandler,
        abi: upgradeHandlerAbi,
        functionName: "upgradeState",
        args: [l1ProposalId],
      });
      if (state !== 0) return null;
      // Era receipts carry batch fields (zksync formatters on the L2 client).
      const receipt = message.receipt as typeof message.receipt & {
        l1BatchNumber: bigint | null;
        l1BatchTxIndex: bigint | null;
      };
      if (receipt.l1BatchNumber === null) {
        return { l2ProposalId, executedTx, ok: false, error: "Not included in an L1 batch yet" };
      }
      const proof = await getLogProof(client as never, { txHash: executedTx, index: 0 }).catch(
        () => null
      );
      if (!proof)
        return {
          l2ProposalId,
          executedTx,
          ok: false,
          error: "L2 → L1 log proof not available yet",
        };
      return {
        l2ProposalId,
        executedTx,
        ok: true,
        l1ProposalId,
        data: {
          l2BatchNumber: numberToHex(receipt.l1BatchNumber),
          l2MessageIndex: numberToHex(proof.id),
          l2TxNumberInBatch:
            receipt.l1BatchTxIndex !== null ? numberToHex(receipt.l1BatchTxIndex) : null,
          proof: proof.proof,
          proposal: message.body,
        },
      };
    })
  );
  return results.filter((r): r is NotStartedUpgrade => r !== null);
}
