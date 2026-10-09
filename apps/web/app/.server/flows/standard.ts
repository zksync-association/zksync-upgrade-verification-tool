import { guardiansAbi, upgradeHandlerAbi } from "@/common/abis";
import {
  approvalExecution,
  executeUpgradeExecution,
  type MemberSignature,
} from "@/common/execution";
import {
  type DecodedCall,
  type UpgradeProposal,
  decodeCall,
  fromAbi,
  upgradeProposalId,
} from "@/common/proposal";
import { type ActionName, buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES, UPGRADE_STATE_LABELS, type UpgradeState } from "@/common/upgrade-states";
import { type Address, type Hex, decodeEventLog, isAddressEqual, zeroAddress } from "viem";
import { FOREVER, cachedUntil, seed } from "../cache";
import { CallReverted, callFn, isFinalBlock } from "../chain/call";
import { IndexIntegrityError, type PuhEvent, puhIndex } from "../chain/puh-index";
import { type Governance, governance } from "../governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import {
  type Network,
  blockTimestamps,
  l1,
  latestBlock,
  network,
  refreshHead,
  safeBlockNumber,
} from "../rpc";
import { type SignatureSet, simulate, simulateCall, verifySignatureSet } from "../signatures";
import {
  type ExecutionView,
  type SetState,
  type UsedSignature,
  callTo,
  compareUsedSignatures,
  decodeApprovalCall,
  eventsWithId,
  executionFor,
  hasArchiveState,
  topicOf,
} from "./common";
import { type Located, indexCannotAnswer, locateEvent } from "./indexed";
import { findL2ProposalForUpgrade } from "./l2";
import { defaultLogger } from "@config/log.server";

async function timedRead<T>(id: Hex, stage: string, read: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await read();
  } finally {
    const elapsedMs = Math.round(performance.now() - start);
    if (elapsedMs >= 1000) defaultLogger.warn({ id, stage, elapsedMs }, "Slow proposal read");
  }
}

const DAY = 86_400n;
// Longest a standard upgrade can still need signatures: 7-day extended legal veto + 30 days waiting.
const ACTIVE_WINDOW_DAYS = 45n;

type Status = {
  creationTimestamp: number;
  securityCouncilApprovalTimestamp: number;
  guardiansApproval: boolean;
  guardiansExtendedLegalVeto: boolean;
  executed: boolean;
};

async function readStatus(id: Hex): Promise<{ state: UpgradeState; status: Status }> {
  const { upgradeHandler } = await network();
  const [state, raw] = await Promise.all([
    l1.readContract({
      address: upgradeHandler,
      abi: upgradeHandlerAbi,
      functionName: "upgradeState",
      args: [id],
    }),
    l1.readContract({
      address: upgradeHandler,
      abi: upgradeHandlerAbi,
      functionName: "upgradeStatus",
      args: [id],
    }),
  ]);
  return {
    state: state as UpgradeState,
    status: {
      creationTimestamp: raw[0],
      securityCouncilApprovalTimestamp: raw[1],
      guardiansApproval: raw[2],
      guardiansExtendedLegalVeto: raw[3],
      executed: raw[4],
    },
  };
}

export type StartedUpgrade = {
  id: Hex;
  proposal: UpgradeProposal;
  // Recomputed from the decoded proposal; must equal the indexed id.
  idMatches: boolean;
  blockNumber: string;
  txHash: Hex;
};

function startedFrom({
  args,
  log,
}: {
  args: PuhEvent<"UpgradeStarted">["args"];
  log: { blockNumber: bigint | null; transactionHash: Hex | null };
}): StartedUpgrade {
  const proposal = fromAbi(args._proposal);
  return {
    id: args._id,
    proposal,
    idMatches: upgradeProposalId(proposal).toLowerCase() === args._id.toLowerCase(),
    blockNumber: (log.blockNumber ?? 0n).toString(),
    txHash: log.transactionHash as Hex,
  };
}

function decodeStarted(log: Awaited<ReturnType<typeof getLogs>>[number]): StartedUpgrade {
  const { args } = decodeEventLog({
    abi: upgradeHandlerAbi,
    eventName: "UpgradeStarted",
    data: log.data,
    topics: log.topics,
  });
  return startedFrom({ args, log });
}

const startedKey = (id: Hex) => `started:${id.toLowerCase()}`;

/**
 * A start the index answered from its final range never changes; one from the unfinalized tail is
 * read again, even once the boundary has passed it. Dev nodes can be rewound.
 */
const startedTtl = (event: { final: boolean }, net: Pick<Network, "isDevNode">) =>
  !net.isDevNode && event.final ? FOREVER : 0;

export type UpgradeSummary = StartedUpgrade & {
  state: UpgradeState;
  stateLabel: string;
  createdAt: number;
  approvedBySecurityCouncil: boolean;
  approvedByGuardians: boolean;
  legalVetoExtended: boolean;
};

export async function listStandardUpgrades({ allHistory }: { allHistory: boolean }) {
  const net = await network();
  const head = await latestBlock();
  const windowStart = head.number - (ACTIVE_WINDOW_DAYS * DAY) / BigInt(net.blockTimeSeconds);
  const from =
    allHistory || windowStart < net.upgradeHandlerDeployBlock
      ? net.upgradeHandlerDeployBlock
      : windowStart;
  // Complete from `from` to the head, or an error: never a partial list.
  const events = await puhIndex().events("UpgradeStarted", { fromBlock: from });
  const upgrades = await Promise.all(
    events.map(async (event): Promise<UpgradeSummary> => {
      const started = startedFrom(event);
      // The detail page then needs no lookup for a final start. Only seeded: the list never
      // waits on (or fails with) a detail lookup of the same id in flight.
      seed(startedKey(started.id), started, startedTtl(event, net));
      const { state, status } = await readStatus(started.id);
      return {
        ...started,
        state,
        stateLabel: UPGRADE_STATE_LABELS[state],
        createdAt: status.creationTimestamp,
        approvedBySecurityCouncil: status.securityCouncilApprovalTimestamp !== 0,
        approvedByGuardians: status.guardiansApproval,
        legalVetoExtended: status.guardiansExtendedLegalVeto,
      };
    })
  );
  return {
    upgrades: upgrades.reverse(),
    fromBlock: from.toString(),
    allHistory: from === net.upgradeHandlerDeployBlock,
  };
}

/**
 * The UpgradeStarted event for `id` from the handler's log index, kept for good once the index
 * answers it from its final range; null when the complete index has none.
 */
function indexedStart(id: Hex): Promise<StartedUpgrade | null> {
  return cachedUntil(startedKey(id), () => readStart(id));
}

async function readStart(id: Hex): Promise<{ value: StartedUpgrade | null; ttlMs: number }> {
  const [net, event] = await Promise.all([network(), puhIndex().single("UpgradeStarted", id)]);
  return event
    ? { value: startedFrom(event), ttlMs: startedTtl(event, net) }
    : { value: null, ttlMs: 0 };
}

/**
 * The start of an upgrade the contract knows (creationTimestamp != 0). From the log index; the
 * legacy lookup only when the index cannot answer. A complete index without the event is an
 * error, never "not found".
 */
async function startedUpgrade(
  id: Hex,
  status: Status,
  net: { isDevNode: boolean },
  indexed: Promise<StartedUpgrade | null>
): Promise<StartedUpgrade> {
  let started: StartedUpgrade | null;
  try {
    started = await indexed;
    if (!started) {
      // The status may come from a newer block than the head the index answered at (the head
      // is cached for 4 s): look once more at the newest head before calling the index wrong.
      // Read directly, not through the cache, which could hand back another request's lookup
      // still answering at the old head.
      refreshHead();
      const again = await readStart(id);
      if (again.value) seed(startedKey(id), again.value, again.ttlMs);
      started = again.value;
    }
  } catch (error) {
    if (!indexCannotAnswer(error, net)) throw error;
    started = await findStarted(id, status.creationTimestamp);
    if (!started) {
      // The contract knows the upgrade: an error (502), never "not found" (404).
      throw new Error(
        `Upgrade ${id} exists on-chain but its UpgradeStarted log was not returned by the RPC. Use an RPC that serves logs.`
      );
    }
    return started;
  }
  if (started) return started;
  throw await missingStart(id, status);
}

/** Why the complete index has no UpgradeStarted for an upgrade the contract knows. */
async function missingStart(id: Hex, status: Status): Promise<Error> {
  const index = puhIndex().status();
  const created = BigInt(status.creationTimestamp);
  if (index.finalizedTo !== null && index.deployBlock !== null) {
    const final = BigInt(index.finalizedTo);
    if (final >= BigInt(index.deployBlock)) {
      const finalTime = (await blockTimestamps([final])).get(final);
      // Created no later than a block the index holds as final: the log must be in it.
      if (finalTime !== undefined && created <= finalTime) {
        return new IndexIntegrityError(
          `ProtocolUpgradeHandler reports upgrade ${id} as created at ${created}, at or before final block ${final}, but its complete log history from block ${index.deployBlock} has no UpgradeStarted event for it. The RPC's logs and state disagree.`
        );
      }
    }
  }
  return new Error(
    `Upgrade ${id} exists on-chain, but its UpgradeStarted log is not in the ProtocolUpgradeHandler logs up to block ${index.headTo ?? "?"} yet. Try again in a moment.`
  );
}

/**
 * Legacy lookup, when the log index cannot answer: the UpgradeStarted event for `id`, found from
 * the on-chain creation timestamp (no full scan).
 */
async function findStarted(id: Hex, creationTimestamp: number): Promise<StartedUpgrade | null> {
  const net = await network();
  const head = await latestBlock();
  const block = await blockAt(creationTimestamp);
  const logs = await getLogs(
    l1,
    { address: net.upgradeHandler, topics: [topicOf(upgradeHandlerAbi, "UpgradeStarted"), id] },
    block,
    // Dev chains can share a timestamp across several blocks.
    block + 16n < head.number ? block + 16n : head.number
  );
  const log = logs[0];
  return log ? decodeStarted(log) : null;
}

export type ApprovalSet = {
  key: "securityCouncil" | "guardians" | "legalVeto";
  title: string;
  set: SignatureSet;
  state: SetState;
  execution: ExecutionView | null;
  // For a completed action: the signatures the transaction used, and whether Safe has the same bytes.
  used: UsedSignature[] | null;
  // Re-verification of the used signatures at the block before execution (needs archive state).
  historical: { block: string; accepted: boolean | null; error: string | null } | null;
};

export type UpgradeTimeline = {
  createdAt: number;
  legalVetoEndsAt: number;
  waitingEndsAt: number;
  approvedAt: number | null;
  readyAt: number | null;
};

export type StandardUpgradeDetail = {
  id: Hex;
  started: StartedUpgrade;
  calls: DecodedCall[];
  state: UpgradeState;
  stateLabel: string;
  status: Status;
  timeline: UpgradeTimeline;
  sets: ApprovalSet[];
  execute: ExecutionView | null;
  executedTx: Hex | null;
  l2Proposal: Awaited<ReturnType<typeof findL2ProposalForUpgrade>>;
  governance: Governance;
};

export class UpgradeNotFound extends Error {}

export type StandardUpgradeOverview = Omit<StandardUpgradeDetail, "sets">;

export type StandardUpgradeCore = Omit<
  StandardUpgradeOverview,
  "execute" | "executedTx" | "l2Proposal"
>;

/** Independent sections start as soon as the status and original proposal are available. */
export async function loadStandardUpgrade(
  id: Hex,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
) {
  const overview = await getStandardUpgradeCore(id);
  const evidence = timedRead(id, "recorded-approvals", () => getRecordedApprovals(overview));
  const sets = timedRead(id, "current-signatures", () =>
    getStandardUpgradeSets(overview, supplied, evidence)
  );
  const execution = timedRead(id, "execution", () => getUpgradeExecution(overview));
  const l2Proposal = timedRead(id, "l2-discovery", () =>
    findL2ProposalForUpgrade(id, overview.status.creationTimestamp, {
      startedTxHash: overview.started.txHash,
    })
  );
  for (const pending of [evidence, sets, execution, l2Proposal]) void pending.catch(() => {});
  return { overview, evidence, sets, execution, l2Proposal };
}

/** JSON waits for the same engine's complete result; the page streams each section separately. */
export async function getStandardUpgrade(
  id: Hex,
  options: { supplied?: MemberSignature[] } = {}
): Promise<StandardUpgradeDetail> {
  const loading = await loadStandardUpgrade(id, options);
  const [sets, execution, l2Proposal] = await Promise.all([
    loading.sets,
    loading.execution,
    loading.l2Proposal.catch(() => null),
  ]);
  return { ...loading.overview, ...execution, l2Proposal, sets };
}

export async function getStandardUpgradeOverview(id: Hex): Promise<StandardUpgradeOverview> {
  const core = await getStandardUpgradeCore(id);
  const [execution, l2Proposal] = await Promise.all([
    getUpgradeExecution(core),
    findL2ProposalForUpgrade(id, core.status.creationTimestamp, {
      startedTxHash: core.started.txHash,
    }).catch(() => null),
  ]);
  return { ...core, ...execution, l2Proposal };
}

export async function getStandardUpgradeCore(id: Hex): Promise<StandardUpgradeCore> {
  // The start event is looked up while governance and the status are read.
  const indexed = indexedStart(id);
  void indexed.catch(() => {});
  const [gov, { state, status }] = await Promise.all([
    timedRead(id, "governance", governance),
    timedRead(id, "status", () => readStatus(id)),
  ]);
  if (state === UPGRADE_STATES.None || status.creationTimestamp === 0) {
    throw new UpgradeNotFound(`ProtocolUpgradeHandler has no standard upgrade ${id}`);
  }
  const started = await timedRead(id, "started-event", () =>
    startedUpgrade(id, status, gov.network, indexed)
  );

  const vetoDays = BigInt(
    status.guardiansExtendedLegalVeto ? 7 : gov.network.standardLegalVetoDays
  );
  const created = BigInt(status.creationTimestamp);
  const timeline: UpgradeTimeline = {
    createdAt: status.creationTimestamp,
    legalVetoEndsAt: Number(created + vetoDays * DAY),
    waitingEndsAt: Number(created + vetoDays * DAY + 30n * DAY),
    approvedAt: status.securityCouncilApprovalTimestamp || null,
    readyAt: status.securityCouncilApprovalTimestamp
      ? status.securityCouncilApprovalTimestamp + Number(DAY)
      : status.guardiansApproval
        ? Number(created + vetoDays * DAY + 31n * DAY)
        : null,
  };

  return {
    id,
    started,
    calls: started.proposal.calls.map(decodeCall),
    state,
    stateLabel: UPGRADE_STATE_LABELS[state],
    status,
    timeline,
    governance: gov,
  };
}

async function getUpgradeExecution(d: StandardUpgradeCore) {
  const { governance: gov, started, state, id } = d;
  let execute: ExecutionView | null = null;
  let executedTx: Hex | null = null;
  if (state === UPGRADE_STATES.Ready) {
    const execution = executeUpgradeExecution(gov.upgradeHandler, started.proposal);
    execute = { ...execution, simulation: await simulateAs(execution, started.proposal.executor) };
  }
  if (state === UPGRADE_STATES.Done) {
    const executed = await locateEvent("UpgradeExecuted", id, gov.network, () =>
      legacyEvent(gov.upgradeHandler, "UpgradeExecuted", id, BigInt(started.blockNumber))
    );
    executedTx = executed?.transactionHash ?? null;
  }
  return { execute, executedTx };
}

function approvalSpecs(d: StandardUpgradeCore) {
  const { governance: gov, status, state } = d;
  const specs: {
    key: ApprovalSet["key"];
    title: string;
    action: Extract<
      ActionName,
      "ApproveUpgradeSecurityCouncil" | "ApproveUpgradeGuardians" | "ExtendLegalVetoPeriod"
    >;
    group: "securityCouncil" | "guardians";
    threshold: number;
    state: SetState;
    event:
      | "UpgradeApprovedBySecurityCouncil"
      | "UpgradeApprovedByGuardians"
      | "UpgradeLegalVetoExtended";
  }[] = [
    {
      key: "securityCouncil",
      title: "Security Council approval",
      action: "ApproveUpgradeSecurityCouncil",
      group: "securityCouncil",
      threshold: gov.securityCouncil.thresholds.approveUpgrade,
      event: "UpgradeApprovedBySecurityCouncil",
      state:
        status.securityCouncilApprovalTimestamp !== 0
          ? { status: "done", detail: "Approved by the Security Council", txHash: null }
          : state === UPGRADE_STATES.Waiting
            ? { status: "open" }
            : { status: "closed", detail: closedReason(state, "Waiting") },
    },
    {
      key: "guardians",
      title: "Guardians approval",
      action: "ApproveUpgradeGuardians",
      group: "guardians",
      threshold: gov.guardians.thresholds.approveUpgrade,
      event: "UpgradeApprovedByGuardians",
      state: status.guardiansApproval
        ? { status: "done", detail: "Approved by the Guardians", txHash: null }
        : state === UPGRADE_STATES.Waiting
          ? { status: "open" }
          : { status: "closed", detail: closedReason(state, "Waiting") },
    },
    {
      key: "legalVeto",
      title: "Legal veto extension (Guardians)",
      action: "ExtendLegalVetoPeriod",
      group: "guardians",
      threshold: gov.guardians.thresholds.extendLegalVeto,
      event: "UpgradeLegalVetoExtended",
      state: status.guardiansExtendedLegalVeto
        ? { status: "done", detail: "Legal veto period extended to 7 days", txHash: null }
        : state === UPGRADE_STATES.LegalVetoPeriod
          ? { status: "open" }
          : { status: "closed", detail: "Only possible during the legal veto period" },
    },
  ];

  return specs;
}

export type RecordedApproval = {
  key: ApprovalSet["key"];
  title: string;
  state: SetState;
  used: ReturnType<typeof decodeApprovalCall>;
  historical: ApprovalSet["historical"];
};

async function getRecordedApprovals(d: StandardUpgradeCore): Promise<RecordedApproval[]> {
  const { governance: gov, status, started, id } = d;
  return Promise.all(
    approvalSpecs(d)
      .filter((s) => s.state.status === "done")
      .map(async (spec) => {
        const contract = spec.group === "securityCouncil" ? gov.securityCouncil : gov.guardians;
        let used: ReturnType<typeof decodeApprovalCall> = null;
        let historical: ApprovalSet["historical"] = null;
        let state = spec.state;
        if (spec.state.status === "done") {
          const event = await locateEvent(spec.event, id, gov.network, async () => {
            // The Security Council approval time is on-chain, so its event is found without a scan.
            const near =
              spec.key === "securityCouncil" && status.securityCouncilApprovalTimestamp
                ? await blockAt(status.securityCouncilApprovalTimestamp)
                : null;
            return legacyEvent(
              gov.upgradeHandler,
              spec.event,
              id,
              near ?? BigInt(started.blockNumber),
              near === null ? undefined : near + 16n
            );
          });
          const txHash = event?.transactionHash ?? null;
          state = { ...spec.state, txHash };
          const call = txHash ? await callTo(txHash, contract.address) : null;
          const decoded = call ? decodeApprovalCall(call.data) : null;
          if (decoded && event) {
            used = decoded;
            const block = event.blockNumber - 1n;
            historical = await recheckAt(
              contract.address,
              {
                hashes: governanceHashes(buildTypedData(spec.action, contract.domain, { id })),
                threshold: spec.threshold,
              },
              decoded,
              block
            );
          }
        }
        return { key: spec.key, title: spec.title, state, used, historical };
      })
  );
}

async function getStandardUpgradeSets(
  d: StandardUpgradeCore,
  supplied: MemberSignature[],
  evidence: Promise<RecordedApproval[]>
): Promise<ApprovalSet[]> {
  const { governance: gov, id } = d;
  const specs = approvalSpecs(d);
  return Promise.all(
    specs.map(async (spec): Promise<ApprovalSet> => {
      const contract = spec.group === "securityCouncil" ? gov.securityCouncil : gov.guardians;
      const set = await verifySignatureSet({
        action: spec.action,
        signerGroup: spec.group,
        typedData: buildTypedData(spec.action, contract.domain, { id }),
        members: contract.members,
        threshold: spec.threshold,
        check: { kind: "multisig", contract: contract.address },
        supplied,
      });
      const execution = await executionFor(set, spec.state, (valid) =>
        approvalExecution(spec.action, contract.address, id, valid)
      );
      const recorded = (await evidence).find((e) => e.key === spec.key);
      const used = recorded?.used ? compareUsedSignatures(recorded.used, set) : null;
      const historical = recorded?.historical ?? null;
      const state = recorded?.state ?? spec.state;
      return { key: spec.key, title: spec.title, set, state, execution, used, historical };
    })
  );
}

async function recheckAt(
  contract: Address,
  set: Pick<SignatureSet, "hashes" | "threshold">,
  used: { signers: readonly Address[]; signatures: readonly Hex[] },
  block: bigint
): Promise<ApprovalSet["historical"]> {
  let archive: boolean;
  try {
    archive = await hasArchiveState(contract, block);
  } catch (error) {
    // No answer about the archive state: not checked this time, never "no archive state".
    return { block: block.toString(), accepted: null, error: `RPC error: ${errorMessage(error)}` };
  }
  if (!archive) {
    return {
      block: block.toString(),
      accepted: null,
      error: "RPC has no archive state for this block",
    };
  }
  const key = `recheck:${contract}:${set.hashes.digest}:${used.signatures.join("")}:${block}`;
  return cachedUntil(key, async () => {
    // The boundary is read before the check: a block at or below it was final when it was read.
    const final = await isFinalBlock(block);
    const value = await recheck(contract, set, used, block);
    // Kept for good only when definite (accepted or a definite revert) at a final block.
    return { value, ttlMs: final && value.accepted !== null ? FOREVER : 0 };
  });
}

async function recheck(
  contract: Address,
  set: Pick<SignatureSet, "hashes" | "threshold">,
  used: { signers: readonly Address[]; signatures: readonly Hex[] },
  block: bigint
): Promise<NonNullable<ApprovalSet["historical"]>> {
  try {
    // checkSignatures returns nothing; callFn requires code at the block for its success to count.
    await callFn({
      address: contract,
      abi: guardiansAbi,
      functionName: "checkSignatures",
      args: [set.hashes.digest, [...used.signers], [...used.signatures], BigInt(set.threshold)],
      blockNumber: block,
    });
    return { block: block.toString(), accepted: true, error: null };
  } catch (error) {
    // accepted: false only for the contract's own revert; an RPC failure leaves it unknown.
    return {
      block: block.toString(),
      accepted: error instanceof CallReverted ? false : null,
      error: error instanceof CallReverted ? error.reason : errorMessage(error),
    };
  }
}

/**
 * Legacy lookup, when the log index cannot answer: an id's event by scanning [fromBlock, toBlock
 * ?? head].
 */
async function legacyEvent(
  handler: Address,
  name: string,
  id: Hex,
  fromBlock: bigint,
  toBlock?: bigint
): Promise<Located | null> {
  const events = await eventsWithId(handler, upgradeHandlerAbi, name, id, fromBlock, toBlock);
  const log = events[0]?.log;
  return log?.transactionHash && log.blockNumber !== null
    ? { transactionHash: log.transactionHash, blockNumber: log.blockNumber }
    : null;
}

async function blockAt(timestamp: number) {
  const net = await network();
  const head = await latestBlock();
  return findBlockByTimestamp(
    l1,
    BigInt(timestamp),
    net.upgradeHandlerDeployBlock,
    head.number,
    net.isDevNode ? null : { key: "l1", safeHead: await safeBlockNumber() }
  );
}

function simulateAs(execution: ExecutionView | Parameters<typeof simulate>[0], executor: Address) {
  // A proposal with an executor can only be executed by it; simulate from that address.
  if (!isAddressEqual(executor, zeroAddress)) {
    return simulateCall({ from: executor, to: execution.to, data: execution.data });
  }
  return simulate(execution);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function closedReason(state: UpgradeState, needed: string) {
  switch (state) {
    case UPGRADE_STATES.LegalVetoPeriod:
      return `Opens when the legal veto period ends (needs state ${needed})`;
    case UPGRADE_STATES.Expired:
      return "The upgrade expired without approval";
    case UPGRADE_STATES.Done:
      return "The upgrade was executed";
    default:
      return `Only possible while the upgrade is ${needed}`;
  }
}
