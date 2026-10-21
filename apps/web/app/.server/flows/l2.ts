import { guardiansAbi, l1MessengerEventAbi, l2GovernorAbi, upgradeHandlerAbi } from "@/common/abis";
import type { L2Proposal } from "@/common/execution";
import { proposalSummary, proposalTitle } from "@/common/proposal-title";
import { STARTABLE_DAYS } from "@/common/startable";
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
import { FOREVER, cached, cachedUntil } from "../cache";
import {
  ERA_PAGE_MAX_AGE_MS,
  type L2GovernorEvent,
  eventsInWindow,
  eventsInWindowAnswer,
  isIndexedL2Governor,
  l2GovernorIndex,
  l2IndexHead,
} from "../chain/l2-index";
import { type Governance, governance } from "../governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import { type L2Head, l1, l2, network, servedHead } from "../rpc";
import { callTo, topicOf } from "./common";
import { L1_MESSENGER, findL2ProposalInBatch, upgradeBatch } from "./l2-batch";

// ZKsync Era side of governance: the governors Guardians can veto, and the protocol governor whose
// executed proposals start L1 upgrades. Pinned governors' logs come from the L2 governor log index;
// a governor replaced through env, or any while Era lacks the 'finalized' tag, is scanned on
// demand. Results near the head are never cached for good.

const DAY = 86_400n;
// 3-day voting delay + 7-day voting period + 7-day possible extension, with margin.
const VETO_WINDOW = 24n * DAY;
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

type Created = {
  proposal: L2Proposal;
  proposalId: bigint;
  proposer: Address;
  voteStart: bigint;
  voteEnd: bigint;
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

/** The governance that names the Guardians: JSON's governance() unless a page passes its own. */
export type GovernanceRead = () => Promise<Governance>;

/** Guardians.hashL2Proposal on L1, a pure function of the content: kept once read. */
async function idOnL1(created: Created, gov: GovernanceRead = governance): Promise<bigint | null> {
  try {
    const { guardians } = await gov();
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

/** A log `fromLastRun` (not read in this run yet) is decoded for this answer only, never kept. */
async function viewOf(
  client: PublicClient,
  governor: Address,
  log: CreatedLog,
  at: L2Head | null,
  {
    fromLastRun = false,
    gov,
    page = false,
  }: { fromLastRun?: boolean; gov?: GovernanceRead; page?: boolean } = {}
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
      // null only for a value outside IGovernor.ProposalState. A failed read fails the caller: an
      // unread state must neither drop a proposal from what Guardians can veto nor close its veto
      // (viem reports Era's code-3 revert and -32603 alike, so no failure here is an answer).
      .then((s) => L2_PROPOSAL_STATES[s] ?? null);
  const [state, governorName, contractId] = await Promise.all([
    at
      ? cached(
          // A page's read is kept apart from JSON's, for as long as pages answer at that head.
          `l2-state${page ? "-page" : ""}:${governor.toLowerCase()}:${created.proposalId}:${at.head.hash}`,
          page ? ERA_PAGE_MAX_AGE_MS : STATE_TTL_MS,
          readState
        )
      : readState(),
    knownGovernors().then(
      (gs) => gs.find((g) => isAddressEqual(g.address, governor))?.name ?? null
    ),
    idOnL1(created, gov),
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

/** `provisional`: partly from the last run's history; `eraHead`: null when scanned on demand. */
export type VetoableAnswer = {
  proposals: L2ProposalView[];
  provisional: boolean;
  eraHead?: { number: string; readAt: string } | null;
};

export const eraHeadOf = (at: L2Head | null) =>
  at && { number: at.head.number.toString(), readAt: new Date(at.answeredAt).toISOString() };

// Proposals of the last 24 days the index does not show executed or canceled (final states).
// `provisional` (pages only): may use the last run's history; states are always read at `at`.
async function recentFromIndex(
  client: PublicClient,
  governors: readonly Address[],
  at: L2Head,
  provisional = false,
  gov?: GovernanceRead,
  page = false
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
      return viewOf(client, governor, e.log, head, { fromLastRun: e.provisional, gov, page });
    })
  );
  return {
    proposals,
    provisional: read.provisional || recent.provisional,
    eraHead: eraHeadOf(head),
  };
}

/** A replaced governor's proposals created in the last 24 days (scanned on demand). */
async function recentFromScan(
  client: PublicClient,
  governor: Address,
  gov?: GovernanceRead
): Promise<L2ProposalView[]> {
  const logs = await scanWindow(client, governor, "ProposalCreated", VETO_WINDOW);
  return Promise.all(logs.map((log) => viewOf(client, governor, log, null, { gov })));
}

/**
 * Proposals on the Token and GovOps governors that Guardians can still veto (Pending, Active, or an
 * unknown state value: listed rather than hidden). A failed read fails the list.
 */
export async function activeL2Proposals(): Promise<L2ProposalView[]> {
  return (await activeL2ProposalsAnswer()).proposals;
}

// Events may come from the last run's history only with `provisional` (a page's first answer).
export async function activeL2ProposalsAnswer({
  provisional = false,
  gov,
  page = false,
}: { provisional?: boolean; gov?: GovernanceRead; page?: boolean } = {}): Promise<VetoableAnswer> {
  const client = await l2();
  if (!client) return { proposals: [], provisional: false, eraHead: null };
  const [net, all] = await Promise.all([network(), knownGovernors()]);
  const governors = all.filter((g) => g.kind !== "protocol");
  const at = governors.some((g) => isIndexedL2Governor(net, g.address))
    ? await l2IndexHead(net, { page })
    : null;
  const indexed = at ? governors.filter((g) => isIndexedL2Governor(net, g.address)) : [];
  const [fromIndex, ...scanned] = await Promise.all([
    at && indexed.length > 0
      ? recentFromIndex(
          client,
          indexed.map((g) => g.address),
          at,
          provisional,
          gov,
          page
        )
      : { proposals: [], provisional: false, eraHead: null },
    ...governors
      .filter((g) => !indexed.includes(g))
      .map((g) => recentFromScan(client, g.address, gov)),
  ]);
  const found = [...(fromIndex?.proposals ?? []), ...scanned.flat()];
  // Per governor, in the order above; each governor's oldest first.
  return {
    proposals: governors
      .flatMap((g) => found.filter((p) => isAddressEqual(p.governor, g.address)))
      .filter(isVetoable),
    provisional: fromIndex?.provisional ?? false,
    eraHead: fromIndex?.eraHead ?? null,
  };
}

/** A specific L2 proposal's content, from its ProposalCreated log, with its state read now. */
export async function getL2Proposal(
  governor: Address,
  proposalId: bigint,
  options: { gov?: GovernanceRead; page?: boolean } = {}
): Promise<L2ProposalView | null> {
  return (await getL2ProposalAnswer(governor, proposalId, options)).proposal;
}

export async function getL2ProposalAnswer(
  governor: Address,
  proposalId: bigint,
  { gov, page = false }: { gov?: GovernanceRead; page?: boolean } = {}
): Promise<{
  proposal: L2ProposalView | null;
  eraHead: { number: string; readAt: string } | null;
}> {
  const client = await l2();
  if (!client) return { proposal: null, eraHead: null };
  const net = await network();
  const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net, { page }) : null;
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
    return {
      proposal: event ? await viewOf(client, governor, event.log, head, { gov, page }) : null,
      eraHead: eraHeadOf(head),
    };
  }
  // Not indexed: found from its on-chain snapshot time.
  const proposal = await cached(`l2-proposal:${governor}:${proposalId}`, 5 * 60_000, async () => {
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
    // Only the matching proposal is read: another's failed state() read must not fail this one.
    const log = logs.find(
      (l) =>
        decodeEventLog({
          abi: l2GovernorAbi,
          eventName: "ProposalCreated",
          data: l.data,
          topics: l.topics,
        }).args.proposalId === proposalId
    );
    return log ? viewOf(client, governor, log, null, { gov }) : null;
  });
  return { proposal, eraHead: null };
}

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

/**
 * ZkProtocolGovernor proposal whose L2 → L1 message is the upgrade `l1Id` (for the Tally link),
 * with its title: the first line of its description (null when it cannot be read now).
 */
export async function findL2ProposalForUpgrade(
  l1Id: Hex,
  creationTimestamp: number,
  options: { startedTxHash?: Hex; strategy?: "batch" | "legacy" } = {}
) {
  const match = await matchL2ProposalForUpgrade(l1Id, creationTimestamp, options);
  if (!match) return null;
  const description = await l2ProposalDescription(match.governor, BigInt(match.proposalId)).catch(
    () => null
  );
  return {
    ...match,
    title: description === null ? null : proposalTitle(description),
    summary: description === null ? null : proposalSummary(description),
  };
}

/** From its ProposalCreated log: the index's when the governor is indexed, else read for it. */
export async function l2ProposalTitle(
  governor: Address,
  proposalId: bigint
): Promise<string | null> {
  const description = await l2ProposalDescription(governor, proposalId);
  return description === null ? null : proposalTitle(description);
}

async function l2ProposalDescription(
  governor: Address,
  proposalId: bigint
): Promise<string | null> {
  const net = await network();
  const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net) : null;
  if (!at) return (await getL2Proposal(governor, proposalId))?.description ?? null;
  const { events } = await l2GovernorIndex().read({ head: at });
  const event = events.find(
    (e) =>
      e.eventName === "ProposalCreated" &&
      isAddressEqual(e.governor, governor) &&
      e.proposalId === proposalId
  );
  return event ? (await createdOf(event.log)).proposal.description : null;
}

/** When an Era transaction was included: its block's time (seconds). */
export async function l2TxTime(txHash: Hex): Promise<number | null> {
  const client = await l2();
  if (!client) return null;
  return cached(`l2-tx-time:${txHash.toLowerCase()}`, 10 * 60_000, async () => {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  });
}

async function matchL2ProposalForUpgrade(
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

/** Kept for good only when the execution is final: its receipt never changes. */
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

// Kept once Era has it (it never changes once the batch is sealed), not while it is missing.
// Never rejects.
function logProofOf(client: PublicClient, txHash: Hex) {
  return cachedUntil(`l2-log-proof:${txHash.toLowerCase()}`, async () => {
    const proof = await getLogProof(client as never, { txHash, index: 0 }).catch(() => null);
    return { value: proof, ttlMs: proof ? FOREVER : 0 };
  });
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

/**
 * Executed ZkProtocolGovernor proposals whose L1 upgrade has not been started yet, among those
 * executed in the last `days` days. With `page` (never JSON): at the Era head pages answer at,
 * kept for as long as they do.
 */
export async function notStartedUpgrades({
  page = false,
  days = STARTABLE_DAYS,
}: { page?: boolean; days?: number } = {}): Promise<NotStartedUpgrade[]> {
  const client = await l2();
  const net = await network();
  if (!client || !net.l2Governors.protocol) return [];
  const governor = net.l2Governors.protocol;
  const at = isIndexedL2Governor(net, governor) ? await l2IndexHead(net, { page }) : null;
  if (page && at)
    return cached(`startable-page:${days}:${at.head.hash.toLowerCase()}`, ERA_PAGE_MAX_AGE_MS, () =>
      readNotStarted(client, net, governor, at, days)
    );
  return readNotStarted(client, net, governor, at, days);
}

async function readNotStarted(
  client: PublicClient,
  net: Awaited<ReturnType<typeof network>>,
  governor: Address,
  at: L2Head | null,
  days: number
): Promise<NotStartedUpgrade[]> {
  const window = BigInt(days) * DAY;
  const logs: { log: Log; final: boolean }[] = at
    ? await executedFromIndex(governor, at, at.head.timestamp - window)
    : (await scanWindow(client, governor, "ProposalExecuted", window)).map((log) => ({
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
      // At the L1 head requests read now (not asking the node), or 'latest' when none is known.
      const head = await (servedHead() ?? Promise.resolve(null)).catch(() => null);
      const state = await l1.readContract({
        address: net.upgradeHandler,
        abi: upgradeHandlerAbi,
        functionName: "upgradeState",
        args: [l1ProposalId],
        ...(head && !net.isDevNode ? { blockNumber: head.number } : {}),
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
      const proof = await logProofOf(client, executedTx);
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
