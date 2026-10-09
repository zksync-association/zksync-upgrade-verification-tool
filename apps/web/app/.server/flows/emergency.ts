import {
  ERC1271_MAGIC_VALUE,
  emergencyUpgradeBoardAbi,
  safeAbi,
  upgradeHandlerAbi,
} from "@/common/abis";
import { type MemberSignature, encodeMultisigSignature } from "@/common/execution";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import {
  type DecodedCall,
  type UpgradeProposal,
  decodeCall,
  upgradeProposalId,
} from "@/common/proposal";
import { type ActionName, buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, decodeAbiParameters, decodeFunctionData, getAddress } from "viem";
import { FOREVER, cached, cachedUntil } from "../cache";
import { CallReverted, callFn, isFinalBlock } from "../chain/call";
import { IndexIntegrityError, type PuhEvent, puhIndex } from "../chain/puh-index";
import { type Governance, governance } from "../governance";
import { governanceFor } from "../page-governance";
import { findBlockByTimestamp, getLogs } from "../logs";
import {
  type Network,
  blockTimestamps,
  l1,
  latestBlock,
  network,
  pageBlockTimestamps,
} from "../rpc";
import type { Freshness, SignatureSet } from "../signatures";
import {
  type UsedSignature,
  callTo,
  compareUsedSignatures,
  firstOrFresh,
  hasArchiveState,
  streamSignatureSet,
  topicOf,
  transactionByHash,
} from "./common";
import { directLookupHelps, emergencyEventDirectly, firstAnswer } from "./direct";
import { firstFromHeld } from "./held";
import { type Collected, collectHeldMessages, collectMessages } from "./messages";
import { type EmergencyEvent, findEmergencyEvent } from "./emergency-event";
import { noteListedEmergencyIds } from "../sync/listed-ids";
import { currentUpgradeStatus } from "../upgrade-status";

// Emergency upgrades sign only the id = keccak256(abi.encode(calls, executor, salt)); Safe never
// sees the calls or salt. Before execution they must come from the proposer (a payload file the
// browser checks against the id, client-side). After execution they are rebuilt from the calldata.

const EMERGENCY_ACTIONS = [
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeZKFoundation",
] as const satisfies readonly ActionName[];

type Executed = { id: Hex; txHash: Hex; blockNumber: bigint };

// Headers read per round when cutting the recent window by timestamp (one JSON-RPC batch).
const TIMESTAMP_BATCH = 20;

/**
 * Executed emergency upgrades, oldest first, from the handler's log index (complete from the
 * deployment to the head, or an error). Full history is opt-in for pages; the JSON list retains
 * it by default.
 */
async function executedEmergencies({ allHistory = true } = {}): Promise<Executed[]> {
  return (await readExecuted({ allHistory, provisional: false })).executed;
}

/**
 * executedEmergencies, for a page when `provisional`: the history and the timestamps the last run
 * read stand in for what this run has not read yet; `provisional` in the answer says they did.
 */
async function readExecuted({
  allHistory,
  provisional: allowed,
}: { allHistory: boolean; provisional: boolean }): Promise<{
  executed: Executed[];
  provisional: boolean;
}> {
  const net = await network();
  if (net.isDevNode)
    return { executed: await legacyExecutedEmergencies(net, allHistory), provisional: false };
  const toExecuted = ({ args, log }: PuhEvent<"EmergencyUpgradeExecuted">): Executed => ({
    id: args._id,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  });
  // A page may be answered from the last run's history; JSON reads only this run's. The last
  // run's history listing one execution twice is not shown: this run's answers instead.
  const strict = async (query?: { fromBlock: bigint }) => ({
    events: await puhIndex().events("EmergencyUpgradeExecuted", query),
    provisional: false,
  });
  const read = async (query?: { fromBlock: bigint }) => {
    if (!allowed) return strict(query);
    const answer = await puhIndex().eventsAnswer("EmergencyUpgradeExecuted", {
      ...query,
      provisional: true,
    });
    const ids = new Set(answer.events.map((e) => e.args._id.toLowerCase()));
    return answer.provisional && ids.size !== answer.events.length ? strict(query) : answer;
  };
  if (allHistory) {
    const answer = await read();
    return { executed: answer.events.map(toExecuted), provisional: answer.provisional };
  }
  // The recent window: executed in a block with timestamp >= head − 7 days. A slot holds at most
  // one block, so those blocks are within the last 7 days / block time; twice that is asked of
  // the index, so the window needs only recent coverage (not the whole backfill). The cut itself
  // is by timestamp: the newest executions are read first, a batch at a time, until one is older.
  const head = await latestBlock();
  const recentSeconds = BigInt(EMERGENCY_RECENT_DAYS * 24 * 60 * 60);
  const cutoff = head.timestamp - recentSeconds;
  const below = head.number - (2n * recentSeconds) / BigInt(net.blockTimeSeconds);
  const fromBlock = below > net.upgradeHandlerDeployBlock ? below : net.upgradeHandlerDeployBlock;
  const answer = await read({ fromBlock });
  const executed = answer.events.map(toExecuted);
  let provisional = answer.provisional;
  const timesOf = async (numbers: bigint[]) => {
    if (!allowed) return blockTimestamps(numbers);
    const read = await pageBlockTimestamps(numbers);
    if (read.provisional) provisional = true;
    return read.times;
  };
  let end = executed.length;
  while (end > 0) {
    const start = Math.max(0, end - TIMESTAMP_BATCH);
    const times = await timesOf(executed.slice(start, end).map((e) => e.blockNumber));
    for (let i = end - 1; i >= start; i--) {
      const time = times.get((executed[i] as Executed).blockNumber) as bigint;
      if (time < cutoff) return { executed: executed.slice(i + 1), provisional };
    }
    end = start;
  }
  return { executed, provisional };
}

/** Dev nodes (which can be rewound) keep the direct scan from the recent window's first block. */
async function legacyExecutedEmergencies(net: Network, allHistory: boolean): Promise<Executed[]> {
  const head = await latestBlock();
  const recentFrom = allHistory
    ? net.upgradeHandlerDeployBlock
    : await findBlockByTimestamp(
        l1,
        head.timestamp - BigInt(EMERGENCY_RECENT_DAYS * 24 * 60 * 60),
        net.upgradeHandlerDeployBlock,
        head.number,
        null
      );
  const logs = await getLogs(
    l1,
    {
      address: net.upgradeHandler,
      topics: [topicOf(upgradeHandlerAbi, "EmergencyUpgradeExecuted")],
    },
    recentFrom,
    head.number
  );
  return logs.map((log) => ({
    id: log.topics[1] as Hex,
    txHash: log.transactionHash as Hex,
    blockNumber: log.blockNumber ?? 0n,
  }));
}

export type EmergencySummary = {
  id: Hex;
  executed: { txHash: Hex; blockNumber: string } | null;
  reported: { securityCouncil: number; guardians: number; zkFoundation: boolean };
  firstSeen: string | null;
};

const summary = (id: Hex): EmergencySummary => ({
  id,
  executed: null,
  reported: { securityCouncil: 0, guardians: 0, zkFoundation: false },
  firstSeen: null,
});

export type PendingEmergencies = {
  pending: EmergencySummary[];
  errors: string[];
  anomalies: number;
  /** When the oldest Safe listing the ids came from was read (ISO time), or null. */
  safeFetchedAt: string | null;
  /**
   * A page's first answer from Safe listings older than 60 s (see loadEmergencyList); the fresh
   * list follows. Always false for the fresh list.
   */
  stale: boolean;
};

/** The ids members signed in their Safes that the handler has not executed (at the head). */
async function pendingFrom(collected: Collected): Promise<PendingEmergencies> {
  const byId = new Map<string, EmergencySummary>();
  for (const group of collected.groups) {
    const id = group.typedData.message.id as Hex;
    const key = id.toLowerCase();
    const entry = byId.get(key) ?? summary(id);
    byId.set(key, entry);
    const n = group.reportedSigners.length;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeSecurityCouncil")
      entry.reported.securityCouncil = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeGuardians")
      entry.reported.guardians = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeZKFoundation")
      entry.reported.zkFoundation = n > 0;
    if (!entry.firstSeen || group.firstSeen < entry.firstSeen) entry.firstSeen = group.firstSeen;
  }
  // While a list of them is on screen, the engine reads these ids' states in each head's snapshot
  // (sync/listed-ids.ts), so the reads below find them at the head.
  noteListedEmergencyIds([...byId.values()].map((entry) => entry.id));
  // Concurrent current-state calls are batched by the RPC client. No archive or log scan needed.
  const entries = await Promise.all(
    [...byId.values()].map(async (entry) => {
      const { status } = await currentUpgradeStatus(entry.id);
      return status.executed ? null : entry;
    })
  );
  return {
    pending: entries
      .filter((entry): entry is EmergencySummary => entry !== null)
      .sort((a, b) => ((a.firstSeen ?? "") < (b.firstSeen ?? "") ? 1 : -1)),
    errors: collected.errors,
    anomalies: collected.anomalies,
    safeFetchedAt: collected.safeFetchedAt ?? null,
    stale: collected.stale === true,
  };
}

/** A page's first list of executed emergency upgrades (see loadEmergencyList). */
export type ExecutedFirst = {
  items: EmergencySummary[];
  /**
   * Listed from the history (or block timestamps) the last run read, while this run re-reads
   * them; the verified list (`executed`) follows.
   */
  fromLastRun: boolean;
};

/**
 * Pending Safe messages and executed events do not wait for one another, and the executions
 * (from the handler's log index alone) do not wait for governance either. With `freshness:
 * "page"`, `pending` is the page's first answer (see firstFromHeld) and `freshPending` the list from
 * listings at most 60 s old; otherwise both are the latter. Likewise `executedFirst` is the
 * page's first list of executions (possibly from the last run's history, `fromLastRun`) and
 * `executed` the list from this run's history; without "page" both are the latter.
 */
export function loadEmergencyList({
  allHistory = false,
  freshness = "strict",
}: { allHistory?: boolean; freshness?: Freshness } = {}) {
  const summaries = (events: Executed[]) =>
    events
      .map((event) => ({
        ...summary(event.id),
        executed: { txHash: event.txHash, blockNumber: event.blockNumber.toString() },
      }))
      .reverse();
  const executedFirst: Promise<ExecutedFirst> = readExecuted({
    allHistory,
    provisional: freshness === "page",
  }).then((read) => ({ items: summaries(read.executed), fromLastRun: read.provisional }));
  const executed = executedFirst.then((first) =>
    first.fromLastRun ? executedEmergencies({ allHistory }).then(summaries) : first.items
  );
  // The members' Safes come from governance (a page's at the head, governance.ts pageGovernance).
  const signers = governanceFor(freshness).then((gov) => ({
    domain: gov.emergencyUpgradeBoard.domain,
    safes: [
      ...gov.securityCouncil.members,
      ...gov.guardians.members,
      gov.emergencyUpgradeBoard.zkFoundation,
    ],
  }));
  const freshPending = signers.then(({ safes, domain }) =>
    collectMessages(safes, EMERGENCY_ACTIONS, domain, { page: freshness === "page" }).then(
      pendingFrom
    )
  );
  const pending =
    freshness === "page"
      ? signers.then(({ safes, domain }) =>
          firstFromHeld(
            collectHeldMessages(safes, EMERGENCY_ACTIONS, domain),
            freshPending,
            pendingFrom
          )
        )
      : freshPending;
  for (const promise of [signers, pending, freshPending, executedFirst, executed])
    void promise.catch(() => {});
  return { pending, freshPending, executedFirst, executed };
}

/**
 * For the sync engine: the emergency list as a page shows it, from the Safe copies held under the
 * page rule (never asking Safe), governance at the head pages read (`governance`: the member Safes
 * collected from, read at its `latestBlock`) and this run's log index; null when a member Safe's
 * copy is not one a page would use as current.
 */
export async function heldEmergencyList({
  allHistory = false,
}: { allHistory?: boolean } = {}): Promise<{
  pending: PendingEmergencies;
  executed: EmergencySummary[];
  governance: Governance;
} | null> {
  const gov = await governanceFor("page");
  const collected = await collectHeldMessages(
    [
      ...gov.securityCouncil.members,
      ...gov.guardians.members,
      gov.emergencyUpgradeBoard.zkFoundation,
    ],
    EMERGENCY_ACTIONS,
    gov.emergencyUpgradeBoard.domain
  );
  if (!collected || collected.stale) return null;
  const [pending, executed] = await Promise.all([
    pendingFrom(collected),
    executedEmergencies({ allHistory }),
  ]);
  return {
    pending,
    executed: executed
      .map((event) => ({
        ...summary(event.id),
        executed: { txHash: event.txHash, blockNumber: event.blockNumber.toString() },
      }))
      .reverse(),
    governance: gov,
  };
}

export async function listRecentEmergencyUpgrades() {
  const loading = await loadEmergencyList();
  const [pending, executed] = await Promise.all([loading.pending, loading.executed]);
  return { ...pending, executed };
}

export async function listEmergencyUpgrades() {
  const gov = await governance();
  const board = gov.emergencyUpgradeBoard;
  const [collected, executed] = await Promise.all([
    collectMessages(
      [...gov.securityCouncil.members, ...gov.guardians.members, board.zkFoundation],
      EMERGENCY_ACTIONS,
      board.domain
    ),
    executedEmergencies(),
  ]);

  const byId = new Map<string, EmergencySummary>();
  const entry = (id: Hex) => {
    const key = id.toLowerCase();
    let e = byId.get(key);
    if (!e) {
      e = {
        id,
        executed: null,
        reported: { securityCouncil: 0, guardians: 0, zkFoundation: false },
        firstSeen: null,
      };
      byId.set(key, e);
    }
    return e;
  };
  for (const group of collected.groups) {
    const e = entry(group.typedData.message.id as Hex);
    const n = group.reportedSigners.length;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeSecurityCouncil")
      e.reported.securityCouncil = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeGuardians")
      e.reported.guardians = n;
    if (group.typedData.primaryType === "ExecuteEmergencyUpgradeZKFoundation")
      e.reported.zkFoundation = n > 0;
    if (!e.firstSeen || group.firstSeen < e.firstSeen) e.firstSeen = group.firstSeen;
  }
  for (const ex of executed) {
    entry(ex.id).executed = { txHash: ex.txHash, blockNumber: ex.blockNumber.toString() };
  }

  const all = [...byId.values()];
  const recent = (e: EmergencySummary) => e.firstSeen ?? "";
  return {
    pending: all.filter((e) => !e.executed).sort((a, b) => (recent(a) < recent(b) ? 1 : -1)),
    executed: all
      .filter((e) => e.executed)
      .sort((a, b) =>
        Number(BigInt(b.executed?.blockNumber ?? 0) - BigInt(a.executed?.blockNumber ?? 0))
      ),
    errors: collected.errors,
    anomalies: collected.anomalies,
  };
}

export type EmergencyRole = {
  key: "securityCouncil" | "guardians" | "zkFoundation";
  title: string;
  set: SignatureSet;
  used: UsedSignature[] | null;
};

export type EmergencyExecution = {
  txHash: Hex;
  blockNumber: string;
  // Rebuilt from the execution calldata.
  proposal: UpgradeProposal;
  calls: DecodedCall[];
  idMatches: boolean;
  // EmergencyUpgradeBoard's three checks re-run at the block before execution (archive state).
  historical: {
    block: string;
    checks: { role: string; accepted: boolean | null; error: string | null }[];
  } | null;
  historicalUnavailable: string | null;
  /**
   * Pages only: the execution event was located directly (archive state and that block's log)
   * while this run's log index was still reading the history, and is not checked against it yet.
   * Never set in JSON.
   */
  locatedDirectly?: true;
  /**
   * Pages only: the execution event came from the history the last run saved, not read again in
   * this run yet. Never set in JSON.
   */
  fromLastRun?: true;
};

export type EmergencyDetail = {
  id: Hex;
  state: number;
  roles: EmergencyRole[];
  executed: EmergencyExecution | null;
  governance: Governance;
};

export type EmergencyOverview = Pick<EmergencyDetail, "id" | "state" | "governance">;

/** What a page shows of an execution first: its calls, rebuilt from its calldata. */
export type EmergencyExecutionFirst = Omit<
  EmergencyExecution,
  "historical" | "historicalUnavailable"
>;

/** The board's three checks of an execution, re-run at the block before it (see EmergencyExecution). */
export type EmergencyHistorical = Pick<EmergencyExecution, "historical" | "historicalUnavailable">;

/**
 * Start execution discovery and current Safe verification independently. With `freshness:
 * "page"`, `first` is the page's first answer (roles from first answers, see firstSignatureSet:
 * the strict result, or labelled stale sets) and `detail` the strict result; otherwise (JSON) both
 * are the strict result.
 *
 * `executed` is the execution from this run's log index. `executedFirst` is what a page shows
 * first: with "page", the calls of the execution from the history the last run saved
 * (`fromLastRun`) while this run re-reads it, or, while the index is still reading the history
 * (and has nothing from the last run), of the one located directly if that comes first
 * (`locatedDirectly`); `executedCheck` then checks either against the index's (an integrity error
 * when they differ; null when there is nothing to check). Such an event stands in for the index's
 * only when it shows an execution of this id: anything else is the index's to answer. The board's
 * re-checks of the execution shown follow in `executedHistorical`, so its calls never wait on
 * archive reads. Without "page", `executedFirst` is `executed`.
 */
export async function loadEmergencyUpgrade(
  id: Hex,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
) {
  // The upgrade's state, governance and, for an executed upgrade, its execution's event are read
  // together (none waits on another), and the event's transaction as soon as the event is known:
  // only telling the board's call apart in it needs governance (the board's address).
  const status = currentUpgradeStatus(id);
  const executedState = status.then(({ state }) => state === UPGRADE_STATES.Done);
  const indexedRead = executedState.then((done) => (done ? findEmergencyEvent(id) : null));
  const locatedRead =
    freshness === "page"
      ? executedState.then(async (done) =>
          done ? pageEvent(id, await network(), indexedRead) : null
        )
      : null;
  for (const event of [indexedRead, locatedRead?.then((l) => l?.event ?? null)])
    void event
      ?.then((e) => e && transactionByHash(e.txHash))
      .catch(() => {
        // Read again, and its failure handled, where the execution is decoded.
      });
  void locatedRead?.catch(() => {});
  const [gov, { state }] = await Promise.all([governanceFor(freshness), status]);
  const board = gov.emergencyUpgradeBoard;

  const specs = [
    {
      key: "securityCouncil",
      title: "Security Council",
      action: "ExecuteEmergencyUpgradeSecurityCouncil",
      members: gov.securityCouncil.members,
      threshold: gov.securityCouncil.eip1271Threshold,
      check: { kind: "multisig-1271", contract: gov.securityCouncil.address },
    },
    {
      key: "guardians",
      title: "Guardians",
      action: "ExecuteEmergencyUpgradeGuardians",
      members: gov.guardians.members,
      threshold: gov.guardians.eip1271Threshold,
      check: { kind: "multisig-1271", contract: gov.guardians.address },
    },
    {
      key: "zkFoundation",
      title: "ZKsync Foundation",
      action: "ExecuteEmergencyUpgradeZKFoundation",
      members: [board.zkFoundation],
      threshold: 1,
      check: { kind: "safe-1271", contract: board.zkFoundation },
    },
  ] as const;

  const streamed = specs.map((spec) =>
    streamSignatureSet(
      {
        action: spec.action,
        signerGroup: spec.key,
        typedData: buildTypedData(spec.action, board.domain, { id }),
        members: [...spec.members],
        threshold: spec.threshold,
        check: spec.check,
        supplied,
        // Signable until the upgrade is executed.
        open: state !== UPGRADE_STATES.Done,
      },
      freshness
    )
  );
  const sets = Promise.all(streamed.map((s) => s.fresh));

  /** An execution event's transaction, decoded; null when it is not an execution sent to the board. */
  const decodedOf = (event: EmergencyEvent) => decodeExecution(event.txHash, board.address);

  /** What an execution event shows first: the calls rebuilt from its calldata. */
  const callsFrom = (event: EmergencyEvent, decoded: Decoded): EmergencyExecutionFirst => ({
    txHash: event.txHash,
    blockNumber: event.blockNumber.toString(),
    proposal: decoded.proposal,
    calls: decoded.proposal.calls.map(decodeCall),
    idMatches: upgradeProposalId(decoded.proposal).toLowerCase() === id.toLowerCase(),
  });

  /** The board's three checks of an execution, re-run at the block before it. */
  const historicalFrom = async (
    event: EmergencyEvent,
    { guardians, securityCouncil, zkFoundation }: Decoded
  ): Promise<EmergencyHistorical> => {
    const block = event.blockNumber - 1n;
    const hashes = specs.map((spec) => ({
      hashes: governanceHashes(buildTypedData(spec.action, board.domain, { id })),
    }));
    // Keyed by the block the checks run at: the same transaction reorged into another block is
    // checked again there, never answered from the old one.
    const recheck = () =>
      cachedUntil(`emergency-recheck:${event.txHash}:${block}`, async () => {
        // The boundary is read before the checks: a block at or below it was final when they
        // were read.
        const final = await isFinalBlock(block);
        const checks = await Promise.all([
          check1271(
            gov.securityCouncil.address,
            hashes[0] as Pick<SignatureSet, "hashes">,
            securityCouncil,
            block,
            "Security Council"
          ),
          check1271(
            gov.guardians.address,
            hashes[1] as Pick<SignatureSet, "hashes">,
            guardians,
            block,
            "Guardians"
          ),
          checkSafe(
            board.zkFoundation,
            hashes[2] as Pick<SignatureSet, "hashes">,
            zkFoundation,
            block
          ),
        ]);
        // Kept for good only when every answer is definite and the block is final.
        const definite = checks.every((check) => check.accepted !== null);
        return { value: checks, ttlMs: final && definite ? FOREVER : 0 };
      });
    // No answer about the archive state: every check reads as not done, with the RPC error
    // (never as "no archive state"), and nothing is kept.
    const archive = await hasArchiveState(board.address, block).catch(
      (error: unknown) => `RPC error: ${error instanceof Error ? error.message : String(error)}`
    );
    const historical: EmergencyExecution["historical"] =
      archive === false
        ? null
        : {
            block: block.toString(),
            checks:
              archive === true
                ? await recheck()
                : specs.map((spec) => ({ role: spec.title, accepted: null, error: archive })),
          };
    const historicalUnavailable =
      archive === false ? "RPC has no archive state for the execution block" : null;
    return { historical, historicalUnavailable };
  };

  /** What an execution event shows: the calls rebuilt from its calldata, and their re-check. */
  const executionOf = async (event: EmergencyEvent): Promise<EmergencyExecution | null> => {
    const decoded = await decodedOf(event);
    if (!decoded) return null;
    return { ...callsFrom(event, decoded), ...(await historicalFrom(event, decoded)) };
  };

  // The index's event; its execution is what JSON and everything that acts on it use.
  const indexedEvent = state === UPGRADE_STATES.Done ? indexedRead : null;
  const executed = (async (): Promise<EmergencyExecution | null> => {
    const event = await indexedEvent;
    return event ? executionOf(event) : null;
  })();
  const historicalOf = (execution: EmergencyExecution | null): EmergencyHistorical | null =>
    execution && {
      historical: execution.historical,
      historicalUnavailable: execution.historicalUnavailable,
    };

  // A page's first execution: the event (see pageEvent) and the calls it shows. One from the
  // history the last run saved, or located directly, is labelled and checked against the index's;
  // it stands in for the index's only when its transaction is an execution of this id sent to the
  // board. One whose transaction is not, whose calls do not hash to the id, or whose read fails is
  // the index's to answer: a page never shows a negative, or an error, from an event the index has
  // not confirmed.
  const located =
    indexedEvent && locatedRead
      ? locatedRead.then(
          async (l): Promise<LocatedEvent> => l ?? { event: await indexedEvent, source: "index" }
        )
      : null;
  const shown: Promise<Shown | null> | null = located
    ? located.then(async ({ event, source }): Promise<Shown | null> => {
        if (source !== "index" && event) {
          const decoded = await decodedOf(event).catch(() => null);
          const execution = decoded && callsFrom(event, decoded);
          if (decoded && execution?.idMatches)
            return {
              event,
              decoded,
              source,
              execution:
                source === "direct"
                  ? { ...execution, locatedDirectly: true }
                  : source === "last-run"
                    ? { ...execution, fromLastRun: true }
                    : execution,
            };
        }
        const indexed = source === "index" ? event : await indexedEvent;
        const decoded = indexed && (await decodedOf(indexed));
        return indexed && decoded
          ? { event: indexed, decoded, source: "index", execution: callsFrom(indexed, decoded) }
          : null;
      })
    : null;
  const executedFirst: Promise<EmergencyExecutionFirst | null> = shown
    ? shown.then((s) => s?.execution ?? null)
    : executed;
  // The board's re-checks of the execution shown first (the index's own: those of `executed`).
  const executedHistorical: Promise<EmergencyHistorical | null> = shown
    ? shown.then((s) =>
        !s
          ? null
          : s.source === "index"
            ? executed.then(historicalOf)
            : historicalFrom(s.event, s.decoded)
      )
    : executed.then(historicalOf);
  // An execution from the last run's history, or located directly, must be the one in this run's
  // complete history.
  const executedCheck: Promise<EmergencyExecution | null> | null = shown
    ? shown.then(async (s) => {
        if (!s || (s.source !== "last-run" && s.source !== "direct")) return null;
        const { event, source } = s;
        const indexed = await indexedEvent;
        if (
          !indexed ||
          indexed.txHash.toLowerCase() !== event.txHash.toLowerCase() ||
          indexed.blockNumber !== event.blockNumber
        ) {
          const from =
            source === "direct" ? "located directly" : "in the history from the last run";
          throw new IndexIntegrityError(
            `The execution of emergency upgrade ${id} ${from} (block ${event.blockNumber}, transaction ${event.txHash}) is not the one in the handler's complete log history (${indexed ? `block ${indexed.blockNumber}, transaction ${indexed.txHash}` : "no execution event"}). Reload the page.`
          );
        }
        return executed;
      })
    : null;

  const overview: EmergencyOverview = { id, state, governance: gov };
  const withRoles = async (
    sets: SignatureSet[],
    execution: EmergencyExecution | null
  ): Promise<EmergencyDetail> => {
    const decoded = execution ? await decodeExecution(execution.txHash, board.address) : null;
    const used = decoded
      ? [
          decoded.securityCouncil,
          decoded.guardians,
          {
            signers: [board.zkFoundation],
            signatures: [decoded.zkFoundation],
          },
        ]
      : [];
    const roles: EmergencyRole[] = specs.map((spec, i) => ({
      key: spec.key,
      title: spec.title,
      set: sets[i] as SignatureSet,
      used: used[i] ? compareUsedSignatures(used[i] as Blob, sets[i] as SignatureSet) : null,
    }));
    return { ...overview, roles, executed: execution } satisfies EmergencyDetail;
  };
  const detail = Promise.all([sets, executed]).then(([sets, execution]) =>
    withRoles(sets, execution)
  );
  // The page's first answer: stale roles are compared with the Safe copies they came from.
  const first = firstOrFresh(streamed, detail, async (immediate) =>
    withRoles(immediate, await executed)
  );
  // Deferred loaders attach their own error handlers after this function returns.
  for (const pending of [
    sets,
    executed,
    shown,
    executedFirst,
    executedHistorical,
    executedCheck,
    detail,
    first,
  ])
    void pending?.catch(() => {});
  return {
    overview,
    executed,
    executedFirst,
    executedHistorical,
    executedCheck,
    detail,
    first,
    // The upgrade's state and status at the head, as read for this answer (a page's revision).
    status,
  };
}

/** JSON retains the complete verification result, including comparisons with Safe's copies. */
export async function getEmergencyUpgrade(
  id: Hex,
  options: { supplied?: MemberSignature[] } = {}
): Promise<EmergencyDetail> {
  return (await loadEmergencyUpgrade(id, options)).detail;
}

/**
 * Where a page's execution event came from (see pageEvent): this run's index ("index"), this
 * run's own reads above the history the last run saved ("run"), that history ("last-run"), or a
 * direct lookup ("direct").
 */
type LocatedEvent = {
  event: EmergencyEvent | null;
  source: "index" | "run" | "last-run" | "direct";
};

/** A page's first execution: its event, where that came from, and the calls it shows. */
type Shown = {
  event: EmergencyEvent;
  decoded: Decoded;
  source: LocatedEvent["source"];
  execution: EmergencyExecutionFirst;
};

/**
 * A page's execution event of an executed emergency upgrade: from the history the last run saved
 * while this run's backfill has not re-read it ("last-run"; an event this run has read itself,
 * above that history, is "run", as a start is in standard.ts pageStart), else this run's index
 * ("index", `indexed`), or, while the index is still reading the history and has nothing from the
 * last run, the event located directly when that comes first ("direct"). Anything the last run's
 * history cannot answer, and any failure there, is the index's to answer.
 */
function pageEvent(
  id: Hex,
  net: { isDevNode: boolean },
  indexed: Promise<EmergencyEvent | null>
): Promise<LocatedEvent> {
  const fromIndex = async (): Promise<LocatedEvent> => ({ event: await indexed, source: "index" });
  const fromHistory: Promise<LocatedEvent> = net.isDevNode
    ? fromIndex()
    : puhIndex()
        .singleAnswer("EmergencyUpgradeExecuted", id, { provisional: true })
        .then(({ event, provisional }) =>
          provisional && event
            ? {
                event: {
                  id,
                  txHash: event.log.transactionHash,
                  blockNumber: event.log.blockNumber,
                },
                source: event.provisional ? ("last-run" as const) : ("run" as const),
              }
            : fromIndex()
        )
        .catch(fromIndex);
  const direct = directLookupHelps(net)
    ? emergencyEventDirectly(id).then((event): LocatedEvent | null =>
        event ? { event, source: "direct" } : null
      )
    : null;
  return firstAnswer(fromHistory, direct).then(({ value }) => value);
}

type Blob = { signers: readonly Address[]; signatures: readonly Hex[] };

/** An executeEmergencyUpgrade transaction, decoded (see decodeExecution). */
type Decoded = NonNullable<Awaited<ReturnType<typeof decodeExecution>>>;

/** calls, salt and the three signature blobs from an executeEmergencyUpgrade transaction. */
async function decodeExecution(txHash: Hex, board: Address) {
  return cached(`emergency-exec:${txHash}`, Number.POSITIVE_INFINITY, async () => {
    const call = await callTo(txHash, board);
    if (!call) return null;
    const { functionName, args } = decodeFunctionData({
      abi: emergencyUpgradeBoardAbi,
      data: call.data,
    });
    if (functionName !== "executeEmergencyUpgrade") return null;
    const [calls, salt, guardiansBlob, councilBlob, zkFoundation] = args;
    const unpack = (blob: Hex): Blob => {
      const [signers, signatures] = decodeAbiParameters(
        [{ type: "address[]" }, { type: "bytes[]" }],
        blob
      );
      return { signers: signers.map((s) => getAddress(s)), signatures };
    };
    const proposal: UpgradeProposal = {
      calls: calls.map((c) => ({
        target: getAddress(c.target),
        value: c.value.toString(),
        data: c.data,
      })),
      executor: board,
      salt,
    };
    return {
      proposal,
      guardians: unpack(guardiansBlob),
      securityCouncil: unpack(councilBlob),
      zkFoundation,
    };
  });
}

type HistoricalCheck = { role: string; accepted: boolean | null; error: string | null };

/**
 * An EIP-1271 isValidSignature at a past block. accepted: false only for a non-magic answer or the
 * contract's own revert; an RPC failure (or an empty result) leaves it unknown (null).
 */
async function historicalCheck(
  role: string,
  address: Address,
  digest: Hex,
  signature: Hex,
  block: bigint
): Promise<HistoricalCheck> {
  try {
    const result = await callFn<Hex>({
      address,
      abi: safeAbi,
      functionName: "isValidSignature",
      args: [digest, signature],
      blockNumber: block,
    });
    return { role, accepted: result === ERC1271_MAGIC_VALUE, error: null };
  } catch (error) {
    return error instanceof CallReverted
      ? { role, accepted: false, error: error.reason }
      : { role, accepted: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function check1271(
  contract: Address,
  set: Pick<SignatureSet, "hashes">,
  used: Blob,
  block: bigint,
  role: string
) {
  return historicalCheck(
    role,
    contract,
    set.hashes.digest,
    encodeMultisigSignature(
      used.signers.map((signer, i) => ({ signer, signature: used.signatures[i] as Hex }))
    ),
    block
  );
}

function checkSafe(
  safe: Address,
  set: Pick<SignatureSet, "hashes">,
  signature: Hex,
  block: bigint
) {
  return historicalCheck("ZKsync Foundation", safe, set.hashes.digest, signature, block);
}
