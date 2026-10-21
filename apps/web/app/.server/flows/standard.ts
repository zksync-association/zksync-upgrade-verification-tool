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
import type { Governance } from "../governance";
import { governanceFor } from "../page-governance";
import type { getLogs } from "../logs";
import { type Network, blockTimestamps, latestBlock, network, refreshHead } from "../rpc";
import {
  type Freshness,
  type SignatureSet,
  prefetchSafeListings,
  simulate,
  simulateCall,
} from "../signatures";
import {
  type ExecutionView,
  type SetState,
  type UsedSignature,
  blockTimeOf,
  callTo,
  compareUsedSignatures,
  decodeApprovalCall,
  eventsWithId,
  executionFor,
  hasArchiveState,
  streamSignatureSet,
} from "./common";
import { blockAt, directLookupHelps, firstAnswer, startedLog } from "./direct";
import { type Located, indexCannotAnswer, locateEvent } from "./indexed";
import { findL2ProposalForUpgrade } from "./l2";
import { defaultLogger } from "@config/log.server";
import { type UpgradeStatus, currentUpgradeStatus } from "../upgrade-status";

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

type Status = UpgradeStatus;

const readStatus = (id: Hex) => currentUpgradeStatus(id);

export type StartedUpgrade = {
  id: Hex;
  proposal: UpgradeProposal;
  // Recomputed from the decoded proposal; must equal the indexed id.
  idMatches: boolean;
  blockNumber: string;
  txHash: Hex;
  /** Pages only (never in JSON, never kept): from the last run's history, not read again yet. */
  fromLastRun?: true;
  /** Pages only (never in JSON, never kept): located directly, not confirmed by the index yet. */
  locatedDirectly?: true;
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

// A start from the final range never changes; one from the unfinalized tail is read again, even
// once the boundary has passed it. Dev nodes can be rewound.
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

export type UpgradeList = {
  upgrades: UpgradeSummary[];
  fromBlock: string;
  allHistory: boolean;
  /** Pages only, never in JSON: from the last run's history while the backfill re-verifies it. */
  fromLastRun?: true;
};

/**
 * Pages only: each listed upgrade's title, from its L2 proposal (null where it cannot be read
 * now). Found once per upgrade and kept, as the upgrade page finds it.
 */
export async function upgradeTitles(list: UpgradeList): Promise<Record<string, string | null>> {
  const titles = await Promise.all(
    list.upgrades.map((u) =>
      findL2ProposalForUpgrade(u.id, u.createdAt, { startedTxHash: u.txHash, page: true }).then(
        (found) => found?.title ?? null,
        () => null
      )
    )
  );
  return Object.fromEntries(list.upgrades.map((u, i) => [u.id, titles[i] ?? null]));
}

/** JSON waits for this run's complete history; a page may use the last run's (`fromLastRun`). */
export async function listStandardUpgrades({
  allHistory,
  days = ACTIVE_WINDOW_DAYS,
  freshness = "strict",
}: { allHistory: boolean; days?: bigint; freshness?: Freshness }): Promise<UpgradeList> {
  const net = await network();
  const head = await latestBlock();
  // At least the active window: every upgrade still in progress is in the list.
  const window = days > ACTIVE_WINDOW_DAYS ? days : ACTIVE_WINDOW_DAYS;
  const windowStart = head.number - (window * DAY) / BigInt(net.blockTimeSeconds);
  const from =
    allHistory || windowStart < net.upgradeHandlerDeployBlock
      ? net.upgradeHandlerDeployBlock
      : windowStart;
  // Complete from `from` to the head, or an error: never a partial list.
  const strict = async () => ({
    events: await puhIndex().events("UpgradeStarted", { fromBlock: from }),
    provisional: false,
  });
  let { events, provisional } =
    freshness === "page"
      ? await puhIndex().eventsAnswer("UpgradeStarted", { fromBlock: from, provisional: true })
      : await strict();
  // The last run's history listing one upgrade twice is not shown: this run's answers instead.
  if (provisional && new Set(events.map((e) => e.args._id.toLowerCase())).size !== events.length)
    ({ events, provisional } = await strict());
  const upgrades = await Promise.all(
    events.map(async (event): Promise<UpgradeSummary> => {
      const started = startedFrom(event);
      // Only seeded: the list never waits on (or fails with) a detail lookup of the same id in
      // flight. A start from the last run's history is not final (startedTtl 0): never kept.
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
    ...(provisional ? { fromLastRun: true as const } : {}),
  };
}

function indexedStart(id: Hex): Promise<StartedUpgrade | null> {
  return cachedUntil(startedKey(id), () => readStart(id));
}

async function pageStart(id: Hex): Promise<StartedUpgrade | null> {
  const { event, provisional } = await puhIndex().singleAnswer("UpgradeStarted", id, {
    provisional: true,
  });
  if (!provisional) return indexedStart(id);
  if (!event) return null;
  return event.provisional ? { ...startedFrom(event), fromLastRun: true } : startedFrom(event);
}

function sameStart(a: StartedUpgrade, b: StartedUpgrade): boolean {
  const proposal = (s: StartedUpgrade) =>
    JSON.stringify(s.proposal, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
  return (
    a.id.toLowerCase() === b.id.toLowerCase() &&
    a.txHash.toLowerCase() === b.txHash.toLowerCase() &&
    a.blockNumber === b.blockNumber &&
    a.idMatches === b.idMatches &&
    proposal(a) === proposal(b)
  );
}

const unconfirmed = (started: StartedUpgrade) =>
  started.fromLastRun === true || started.locatedDirectly === true;

async function confirmedStart(core: StandardUpgradeCore): Promise<StandardUpgradeCore> {
  if (!unconfirmed(core.started)) return core;
  const started = await startedUpgrade(
    core.id,
    core.status,
    core.governance.network,
    indexedStart(core.id)
  );
  if (!sameStart(started, core.started)) {
    const source = core.started.fromLastRun
      ? "in the history from the last run"
      : "located directly";
    throw new IndexIntegrityError(
      `The start of upgrade ${core.id} ${source} (block ${core.started.blockNumber}, transaction ${core.started.txHash}) is not the one in the handler's complete log history (block ${started.blockNumber}, transaction ${started.txHash}). Reload the page.`
    );
  }
  return { ...core, started, calls: started.proposal.calls.map((call) => decodeCall(call)) };
}

// The index's start, or the one located directly from the creation time if that comes first
// (`locatedDirectly`; confirmedStart checks it against the index's).
async function pageLocatedStart(
  id: Hex,
  status: Status,
  indexed: Promise<StartedUpgrade | null>
): Promise<StartedUpgrade | null> {
  const net = await network();
  const direct =
    status.creationTimestamp !== 0 && directLookupHelps(net)
      ? findStarted(id, status.creationTimestamp).then((started) =>
          started ? { ...started, locatedDirectly: true as const } : null
        )
      : null;
  return (await firstAnswer(indexed, direct)).value;
}

async function readStart(id: Hex): Promise<{ value: StartedUpgrade | null; ttlMs: number }> {
  const [net, event] = await Promise.all([network(), puhIndex().single("UpgradeStarted", id)]);
  return event
    ? { value: startedFrom(event), ttlMs: startedTtl(event, net) }
    : { value: null, ttlMs: 0 };
}

/** A complete index without the event is an error, never "not found". */
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
      // The status and the index each read the cached head, and a newer head can be served between
      // the two reads: look once more at the newest head before calling the index wrong. Directly,
      // not through the cache, which could hand back another request's lookup at the old head.
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

/** The UpgradeStarted event for `id`, found from the on-chain creation timestamp (no full scan). */
async function findStarted(id: Hex, creationTimestamp: number): Promise<StartedUpgrade | null> {
  const log = await startedLog(id, creationTimestamp);
  const started = log ? decodeStarted(log) : null;
  // Only the start of this id: its calls are checked against this id, never another's.
  return started && started.id.toLowerCase() === id.toLowerCase() ? started : null;
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
  /** The last moment to approve: then it expires, or the Guardians' approval takes effect. */
  waitingEndsAt: number;
  approvedAt: number | null;
  readyAt: number | null;
  /** From approval to "Ready" (seconds; 0 on a testnet handler). */
  delaySeconds: number;
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
  /** The execution's block time (unix seconds), when it could be read. */
  executedAt: string | null;
  l2Proposal: Awaited<ReturnType<typeof findL2ProposalForUpgrade>>;
  governance: Governance;
};

export class UpgradeNotFound extends Error {}

export type StandardUpgradeOverview = Omit<StandardUpgradeDetail, "sets">;

export type StandardUpgradeCore = Omit<
  StandardUpgradeOverview,
  "execute" | "executedTx" | "executedAt" | "l2Proposal"
>;

/**
 * Independent sections start as soon as the status and original proposal are available; `sets`
 * never wait on the recorded approvals' re-checks (`setEvidence` adds those). A page's `sets` may
 * be labelled stale first answers (no execution); `freshSets` is the strict result.
 */
export async function loadStandardUpgrade(
  id: Hex,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
) {
  // The members' Safe listings are read as soon as the upgrade is known to exist, while its
  // proposal is looked up in the log index (which may wait for the backfill), not after it.
  const overview = await getStandardUpgradeCore(id, {
    onExists: (gov) =>
      prefetchSafeListings([...gov.securityCouncil.members, ...gov.guardians.members], {
        page: freshness === "page",
      }),
    freshness,
  });
  // A page may show an unconfirmed start (`fromLastRun`, `locatedDirectly`); whatever acts on the
  // proposal (its execution, the recorded approvals, the L2 proposal) waits for this run's index.
  const confirmed = confirmedStart(overview);
  const startedCheck = unconfirmed(overview.started)
    ? confirmed.then((core) => core.started)
    : null;
  const evidence = confirmed.then((core) =>
    timedRead(id, "recorded-approvals", () => getRecordedApprovals(core))
  );
  const streamed = streamStandardUpgradeSets(overview, supplied, freshness);
  const freshSets = timedRead(id, "current-signatures", () => streamed.fresh);
  const sets = streamed.immediate;
  const setEvidence = Promise.all([freshSets, evidence]).then(([verified, records]) =>
    verified.map((set) => evidenceFor(set, records))
  );
  const execution = confirmed.then((core) =>
    timedRead(id, "execution", () => getUpgradeExecution(core, freshness === "page"))
  );
  const l2Proposal = confirmed.then((core) =>
    timedRead(id, "l2-discovery", () =>
      findL2ProposalForUpgrade(id, core.status.creationTimestamp, {
        startedTxHash: core.started.txHash,
        page: freshness === "page",
      })
    )
  );
  for (const pending of [
    confirmed,
    startedCheck,
    evidence,
    sets,
    freshSets,
    setEvidence,
    execution,
    l2Proposal,
  ])
    void pending?.catch(() => {});
  return { overview, startedCheck, evidence, sets, freshSets, setEvidence, execution, l2Proposal };
}

/** JSON waits for the same engine's complete result; the page streams each section separately. */
export async function getStandardUpgrade(
  id: Hex,
  options: { supplied?: MemberSignature[] } = {}
): Promise<StandardUpgradeDetail> {
  const loading = await loadStandardUpgrade(id, { ...options, freshness: "strict" });
  const [sets, evidence, execution, l2Proposal] = await Promise.all([
    loading.freshSets,
    loading.setEvidence,
    loading.execution,
    loading.l2Proposal.catch(() => null),
  ]);
  return {
    ...loading.overview,
    ...execution,
    l2Proposal,
    sets: sets.map((set) => withEvidence(set, evidence)),
  };
}

export type SetEvidence = Pick<ApprovalSet, "key" | "state" | "used" | "historical">;

function evidenceFor(set: ApprovalSet, records: RecordedApproval[]): SetEvidence {
  const recorded = records.find((e) => e.key === set.key);
  return {
    key: set.key,
    state: recorded?.state ?? set.state,
    used: recorded?.used ? compareUsedSignatures(recorded.used, set.set) : null,
    historical: recorded?.historical ?? null,
  };
}

function withEvidence(set: ApprovalSet, evidence: readonly SetEvidence[]): ApprovalSet {
  const found = evidence.find((e) => e.key === set.key);
  return found ? { ...set, ...found } : set;
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

/** JSON's start always comes from this run's index; a page's may not be confirmed yet. */
export async function getStandardUpgradeCore(
  id: Hex,
  {
    onExists,
    freshness = "strict",
  }: { onExists?: (gov: Governance) => void; freshness?: Freshness } = {}
): Promise<StandardUpgradeCore> {
  // The start is looked up while governance and the status are read, not after.
  const indexed = freshness === "page" ? pageStart(id) : indexedStart(id);
  void indexed.catch(() => {});
  const statusRead = timedRead(id, "status", () => readStatus(id));
  const located =
    freshness === "page"
      ? statusRead.then(({ status }) => pageLocatedStart(id, status, indexed))
      : indexed;
  void located.catch(() => {});
  const [gov, { state, status }] = await Promise.all([
    timedRead(id, "governance", () => governanceFor(freshness)),
    statusRead,
  ]);
  if (state === UPGRADE_STATES.None || status.creationTimestamp === 0) {
    throw new UpgradeNotFound(`ProtocolUpgradeHandler has no standard upgrade ${id}`);
  }
  onExists?.(gov);
  const started = await timedRead(id, "started-event", () =>
    startedUpgrade(id, status, gov.network, located)
  );

  const vetoDays = BigInt(
    status.guardiansExtendedLegalVeto ? 7 : gov.network.standardLegalVetoDays
  );
  const created = BigInt(status.creationTimestamp);
  const delay = BigInt(gov.network.upgradeDelayDays ?? 1) * DAY;
  const timeline: UpgradeTimeline = {
    createdAt: status.creationTimestamp,
    legalVetoEndsAt: Number(created + vetoDays * DAY),
    waitingEndsAt: Number(created + vetoDays * DAY + 30n * DAY),
    approvedAt: status.securityCouncilApprovalTimestamp || null,
    readyAt: status.securityCouncilApprovalTimestamp
      ? status.securityCouncilApprovalTimestamp + Number(delay)
      : status.guardiansApproval
        ? Number(created + vetoDays * DAY + 30n * DAY + delay)
        : null,
    delaySeconds: Number(delay),
  };

  return {
    id,
    started,
    calls: started.proposal.calls.map((call) => decodeCall(call)),
    state,
    stateLabel: UPGRADE_STATE_LABELS[state],
    status,
    timeline,
    governance: gov,
  };
}

async function getUpgradeExecution(d: StandardUpgradeCore, page = false) {
  const { governance: gov, started, state, id } = d;
  let execute: ExecutionView | null = null;
  let executedTx: Hex | null = null;
  let executedAt: string | null = null;
  if (state === UPGRADE_STATES.Ready) {
    const execution = executeUpgradeExecution(gov.upgradeHandler, started.proposal);
    execute = {
      ...execution,
      simulation: await simulateAs(execution, started.proposal.executor, page),
    };
  }
  if (state === UPGRADE_STATES.Done) {
    const executed = await locateEvent("UpgradeExecuted", id, gov.network, () =>
      legacyEvent(gov.upgradeHandler, "UpgradeExecuted", id, BigInt(started.blockNumber))
    );
    executedTx = executed?.transactionHash ?? null;
    executedAt = executed ? await blockTimeOf(executed.blockNumber) : null;
  }
  return { execute, executedTx, executedAt };
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
          // When: the Security Council's approval time is on-chain; the others', their block's.
          const at =
            spec.key === "securityCouncil" && status.securityCouncilApprovalTimestamp
              ? String(status.securityCouncilApprovalTimestamp)
              : event
                ? await blockTimeOf(event.blockNumber)
                : null;
          state = { ...spec.state, txHash, at };
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

/** A stale first answer has no execution: nothing is offered to send from it. */
function streamStandardUpgradeSets(
  d: StandardUpgradeCore,
  supplied: MemberSignature[],
  freshness: Freshness
): { immediate: Promise<ApprovalSet[]>; fresh: Promise<ApprovalSet[]> } {
  const { governance: gov, id } = d;
  const each = approvalSpecs(d).map((spec) => {
    const contract = spec.group === "securityCouncil" ? gov.securityCouncil : gov.guardians;
    const streamed = streamSignatureSet(
      {
        action: spec.action,
        signerGroup: spec.group,
        typedData: buildTypedData(spec.action, contract.domain, { id }),
        members: contract.members,
        threshold: spec.threshold,
        check: { kind: "multisig", contract: contract.address },
        supplied,
        open: spec.state.status === "open",
      },
      freshness
    );
    const approval = (set: SignatureSet, execution: ExecutionView | null): ApprovalSet => ({
      key: spec.key,
      title: spec.title,
      set,
      state: spec.state,
      execution,
      used: null,
      historical: null,
    });
    const fresh = streamed.fresh.then(async (set) =>
      approval(
        set,
        await executionFor(
          set,
          spec.state,
          (valid) => approvalExecution(spec.action, contract.address, id, valid),
          { page: freshness === "page" }
        )
      )
    );
    const immediate =
      streamed.immediate === streamed.fresh
        ? fresh
        : streamed.immediate.then((set) => (set.stale ? approval(set, null) : fresh));
    return { immediate, fresh };
  });
  const immediate = Promise.all(each.map((e) => e.immediate));
  const fresh = Promise.all(each.map((e) => e.fresh));
  for (const pending of [immediate, fresh]) void pending.catch(() => {});
  return { immediate, fresh };
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

function simulateAs(
  execution: ExecutionView | Parameters<typeof simulate>[0],
  executor: Address,
  page = false
) {
  // The proposal comes from its UpgradeStarted log, nothing the viewer supplied: kept per head.
  // A proposal with an executor can only be executed by it; simulate from that address.
  if (!isAddressEqual(executor, zeroAddress)) {
    return simulateCall(
      { from: executor, to: execution.to, data: execution.data },
      { keep: true, page }
    );
  }
  return simulate(execution, { keep: true, page });
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
