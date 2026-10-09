import { clearCache, peek } from "@/.server/cache";
import { type ProvisionalOutcome, parseLogs } from "@/.server/chain/log-index";
import { IndexIntegrityError, puhIndex } from "@/.server/chain/puh-index";
import type { EmergencyEvent } from "@/.server/flows/emergency-event";
import { loadEmergencyList, loadEmergencyUpgrade } from "@/.server/flows/emergency";
import {
  type StartedUpgrade,
  getStandardUpgradeCore,
  loadStandardUpgrade,
} from "@/.server/flows/standard";
import { resetLogCaches } from "@/.server/logs";
import { resetRpcClients } from "@/.server/rpc";
import { emergencyExecution } from "@/common/execution";
import { type UpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, type Log, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startedLogOf as narrowStartedLog } from "@/.server/flows/direct";
import {
  type ChainLog,
  type PuhHistory,
  PUH_TOPICS,
  fakeChain,
  puhHistory,
  rawLog,
  txHash,
} from "../support/fake-chain";
import { type FakeCall, type FakePost, fakeJsonRpc } from "../support/fake-jsonrpc";

// While the log index still reads the history, a detail page looks the event up directly, shows
// it labelled "located directly" and checks it against the index (the same event, or an integrity
// error). Nothing found directly is kept or acted on, and JSON waits for the index.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
const SAVED = FINAL - 3_000n;
const CAP = 10_000n;
const time = (n: bigint) => 1_700_000_000n + n * 12n;

const state = vi.hoisted(() => ({
  network: {} as Record<string, unknown>,
  // id → [creationTimestamp, executed]
  status: new Map<string, [number, boolean]>(),
  // txHash → calldata of the transaction (to the board)
  transactions: new Map<string, Hex>(),
  // txHash → reads of the transaction that fail (once each) before it answers
  failing: new Map<string, number>(),
  txReads: [] as string[],
}));

// The direct lookups, controlled by each test; the rest of direct.ts (when to look, the race) is
// the real one.
const direct = vi.hoisted(() => ({
  started: vi.fn<(id: Hex, creationTimestamp: number) => Promise<Log | null>>(),
  emergency: vi.fn<(id: Hex) => Promise<EmergencyEvent | null>>(),
}));
vi.mock("@/.server/flows/direct", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/flows/direct")>()),
  startedLog: (id: Hex, creationTimestamp: number) => direct.started(id, creationTimestamp),
  emergencyEventDirectly: (id: Hex) => direct.emergency(id),
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

// Contract state from `state.status`; logs and headers from the fake chain through the lanes.
vi.mock("@/.server/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/rpc")>();
  const l1 = {
    readContract: async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
      const status = state.status.get(args[0].toLowerCase());
      if (functionName === "upgradeState") {
        if (!status) return UPGRADE_STATES.None;
        return status[1] ? UPGRADE_STATES.Done : UPGRADE_STATES.LegalVetoPeriod;
      }
      if (functionName === "upgradeStatus") {
        const [created, executed] = status ?? [0, false];
        return [created, 0, false, false, executed];
      }
      throw new Error(`Unexpected ${functionName}`);
    },
    getTransaction: async ({ hash }: { hash: Hex }) => {
      state.txReads.push(hash.toLowerCase());
      const failing = state.failing.get(hash.toLowerCase()) ?? 0;
      if (failing > 0) {
        state.failing.set(hash.toLowerCase(), failing - 1);
        throw new Error("HTTP 503 upstream");
      }
      return {
        hash,
        to: state.transactions.has(hash.toLowerCase())
          ? PUH
          : "0x0000000000000000000000000000000000000001",
        input: state.transactions.get(hash.toLowerCase()) ?? "0x",
      };
    },
  };
  return { ...actual, l1, l1State: l1 };
});

const domain = (name: string) => ({ name, version: "1", chainId: 1, verifyingContract: PUH });
const GOVERNANCE = {
  network: { isDevNode: false, standardLegalVetoDays: 3, chainId: 1 },
  upgradeHandler: PUH,
  securityCouncil: {
    address: PUH,
    members: [],
    thresholds: { approveUpgrade: 6 },
    eip1271Threshold: 9,
    domain: domain("SecurityCouncil"),
  },
  guardians: {
    address: PUH,
    members: [],
    thresholds: { approveUpgrade: 5, extendLegalVeto: 2 },
    eip1271Threshold: 5,
    domain: domain("Guardians"),
  },
  // The board is the handler's address here, so the fake transactions are sent to it.
  emergencyUpgradeBoard: {
    address: PUH,
    zkFoundation: "0x0000000000000000000000000000000000000f00",
    domain: domain("EmergencyUpgradeBoard"),
  },
};
// Governance answers at once, unless a test holds it.
const gov = vi.hoisted(() => ({ held: null as Promise<unknown> | null }));
vi.mock("@/.server/governance", () => ({
  governance: () => gov.held ?? Promise.resolve(GOVERNANCE),
}));
vi.mock("@/.server/flows/l2", () => ({ findL2ProposalForUpgrade: async () => null }));
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => ({ groups: [], errors: [], anomalies: 0 }),
  collectHeldMessages: async () => null,
}));
vi.mock("@/.server/signatures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/signatures")>()),
  verifySignatureSet: async () => {
    throw new Error("signature sets are not part of these tests");
  },
  firstSignatureSet: async (_: unknown, fresh: Promise<unknown>) => fresh,
}));

const isHeld = (call: FakeCall, below: bigint) =>
  call.method === "eth_getLogs" &&
  BigInt((call.params[0] as { fromBlock: Hex }).fromBlock) <= below;

/**
 * The chain, with this run's backfill (reads from at or below `holdBelow`: by default all but the
 * tail) held until `release()`, and POSTs with a call `holdCall` picks held until `releaseCalls()`.
 */
function upstream({
  holdBelow = FINAL,
  holdCall,
}: { holdBelow?: bigint; holdCall?: (call: FakeCall) => boolean } = {}) {
  const history = withEmergencyProposals(puhHistory(DEPLOY, FINAL));
  const chain = fakeChain({
    address: PUH,
    logs: history.logs,
    cap: CAP,
    head: { number: HEAD },
    finalized: FINAL,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseCalls!: () => void;
  const callGate = new Promise<void>((resolve) => {
    releaseCalls = resolve;
  });
  const fake = fakeJsonRpc({
    handle: (call) => chain.handle(call),
    intercept: async (post: FakePost) => {
      if (post.calls.some((call) => isHeld(call, holdBelow))) await gate;
      if (holdCall && post.calls.some(holdCall)) await callGate;
      return undefined;
    },
  });
  vi.stubGlobal("fetch", fake.fetch);
  for (const upgrade of history.upgrades)
    state.status.set(upgrade.id.toLowerCase(), [Number(time(upgrade.started)), true]);
  history.emergencies.forEach((emergency, i) => {
    state.status.set(emergency.id.toLowerCase(), [0, true]);
    state.transactions.set(executionTx(history, emergency.id).toLowerCase(), calldata(i));
  });
  return { history, chain, release, releaseCalls };
}

const emergencyProposal = (i: number): UpgradeProposal => ({
  calls: [{ target: PUH, value: "0", data: "0x" }],
  executor: PUH,
  salt: `0x${i.toString(16).padStart(64, "0")}`,
});

/** The fake history with each emergency upgrade's id replaced by its proposal's id, as on chain. */
function withEmergencyProposals(history: PuhHistory): PuhHistory {
  const ids = new Map<string, Hex>();
  const emergencies = history.emergencies.map((emergency, i) => {
    const id = upgradeProposalId(emergencyProposal(i));
    ids.set(emergency.id.toLowerCase(), id);
    return { ...emergency, id };
  });
  const logs = history.logs.map((log) => {
    const id = log.topics[1] && ids.get(log.topics[1].toLowerCase());
    return log.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted && id
      ? { ...log, topics: [log.topics[0], id, ...log.topics.slice(2)] }
      : log;
  });
  return { ...history, logs, emergencies };
}

const calldata = (i: number) =>
  emergencyExecution(PUH, emergencyProposal(i), [], [], "0x01").data as Hex;

const logOf = (history: PuhHistory, topic: Hex, id: Hex) =>
  history.logs.find(
    (l) => l.topics[0] === topic && l.topics[1]?.toLowerCase() === id.toLowerCase()
  ) as ChainLog;

const executionTx = (history: PuhHistory, id: Hex) =>
  txHash(logOf(history, PUH_TOPICS.EmergencyUpgradeExecuted, id));

/** A start's log as the narrow direct read returns it (viem's shape). */
function startedLogOf(history: PuhHistory, id: Hex, change: Partial<ChainLog> = {}): Log {
  const log = { ...logOf(history, PUH_TOPICS.UpgradeStarted, id), ...change };
  const raw = rawLog({ address: PUH }, log);
  return {
    ...raw,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionIndex: 0,
    address: PUH,
  } as unknown as Log;
}

function seedLastRun(history: PuhHistory, change: (log: ChainLog) => ChainLog = (log) => log) {
  const saved = history.logs
    .filter((l) => l.blockNumber <= SAVED)
    .map(change)
    .map((l) => rawLog({ address: PUH }, l));
  const outcomes: ProvisionalOutcome[] = [];
  puhIndex().seedProvisional(
    {
      chainId: 1,
      address: PUH,
      deployBlock: DEPLOY,
      finalizedTo: SAVED,
      logs: parseLogs(saved, { addresses: [PUH] }, DEPLOY, SAVED),
    },
    (outcome) => outcomes.push(outcome)
  );
  return outcomes;
}

async function settles(promise: Promise<unknown> | null, ms = 50): Promise<boolean> {
  let done = false;
  promise?.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return done;
}

beforeEach(() => {
  resetRpcClients();
  resetLogCaches();
  clearCache();
  state.status.clear();
  state.transactions.clear();
  state.failing.clear();
  state.txReads = [];
  gov.held = null;
  direct.started.mockReset().mockResolvedValue(null);
  direct.emergency.mockReset().mockResolvedValue(null);
  state.network = {
    chainId: 1,
    upgradeHandler: PUH,
    upgradeHandlerDeployBlock: DEPLOY,
    blockTimeSeconds: 12,
    logCanary: {
      address: PUH,
      topic0: toEventSelector("ChangeSecurityCouncil(address,address)"),
      blockNumber: DEPLOY,
    },
    isDevNode: false,
    forkBlock: null,
    safeTxServiceUrl: null,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an upgrade's start, while the index reads the history", () => {
  it("is located directly on a page, labelled, and confirmed by the index", async () => {
    const { history, release } = upstream();
    const upgrade = history.upgrades[3] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(async (id) => startedLogOf(history, id));

    const loading = await loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(direct.started).toHaveBeenCalledWith(upgrade.id, Number(time(upgrade.started)));
    expect(loading.overview.started).toMatchObject({
      id: upgrade.id,
      blockNumber: upgrade.started.toString(),
      idMatches: true,
      locatedDirectly: true,
    });
    expect(loading.overview.started.fromLastRun).toBeUndefined();
    expect(loading.overview.calls).toHaveLength(1);
    // What acts on the proposal, and the check, wait for the index.
    expect(loading.startedCheck).not.toBeNull();
    expect(await settles(loading.startedCheck)).toBe(false);
    expect(await settles(loading.execution)).toBe(false);

    release();
    const confirmed = (await loading.startedCheck) as StartedUpgrade;
    expect(confirmed.locatedDirectly).toBeUndefined();
    expect(confirmed.txHash).toBe(loading.overview.started.txHash);
    expect((await loading.execution).executedTx).toBe(
      txHash(logOf(history, PUH_TOPICS.UpgradeExecuted, upgrade.id))
    );
    // Only the index's start is kept.
    const kept = (await peek<StartedUpgrade>(`started:${upgrade.id.toLowerCase()}`)) ?? null;
    expect(kept?.txHash).toBe(confirmed.txHash);
    expect(kept && "locatedDirectly" in kept).toBe(false);
  });

  it("that the index contradicts fails the page's check, never passes", async () => {
    const { history, release } = upstream();
    const upgrade = history.upgrades[5] as PuhHistory["upgrades"][number];
    // The same block and proposal, another log (and so another transaction).
    direct.started.mockImplementation(async (id) => startedLogOf(history, id, { logIndex: 7 }));

    const loading = await loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(loading.overview.started.locatedDirectly).toBe(true);
    release();
    await expect(loading.startedCheck).rejects.toBeInstanceOf(IndexIntegrityError);
    await expect(loading.startedCheck).rejects.toThrow(/located directly/);
    await expect(loading.execution).rejects.toBeInstanceOf(IndexIntegrityError);
  });

  it.each([
    ["finds nothing", async () => null],
    [
      "fails",
      async () => {
        throw new Error("header not found");
      },
    ],
  ])("leaves the page to the index when the direct lookup %s", async (_, lookup) => {
    const { history, release } = upstream();
    const upgrade = history.upgrades[2] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(lookup);

    const loading = loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(await settles(loading)).toBe(false);
    release();
    const page = await loading;
    expect(page.overview.started.locatedDirectly).toBeUndefined();
    expect(page.startedCheck).toBeNull();
  });

  it("of another upgrade, from an RPC's narrow read, is never shown for this id", async () => {
    const { history, release } = upstream();
    const upgrade = history.upgrades[3] as PuhHistory["upgrades"][number];
    const other = history.upgrades[4] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(async () => startedLogOf(history, other.id));

    const loading = loadStandardUpgrade(upgrade.id, { freshness: "page" });
    // Not shown: the page waits for the index instead.
    expect(await settles(loading)).toBe(false);
    release();
    const page = await loading;
    expect(page.overview.started.id).toBe(upgrade.id);
    expect(page.overview.started.idMatches).toBe(true);
    expect(page.overview.started.locatedDirectly).toBeUndefined();
    expect(page.startedCheck).toBeNull();
  });

  it("is never located directly for JSON, which waits for the index", async () => {
    const { history, release } = upstream();
    const upgrade = history.upgrades[3] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(async (id) => startedLogOf(history, id));

    const json = getStandardUpgradeCore(upgrade.id);
    expect(await settles(json)).toBe(false);
    release();
    const core = await json;
    expect("locatedDirectly" in core.started).toBe(false);
    expect(direct.started).not.toHaveBeenCalled();
  });

  it("is not looked up directly once the index has the whole history", async () => {
    const { history, release } = upstream();
    release();
    await puhIndex().events("UpgradeStarted");
    const upgrade = history.upgrades[3] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(async (id) => startedLogOf(history, id));

    const loading = await loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(loading.overview.started.locatedDirectly).toBeUndefined();
    expect(direct.started).not.toHaveBeenCalled();
  });

  it("is not looked up directly while the last run's history can answer", async () => {
    // Held: this run's backfill below the saved history's boundary (the reads above it are not).
    const { history, release } = upstream({ holdBelow: SAVED });
    seedLastRun(history);
    const upgrade = history.upgrades[3] as PuhHistory["upgrades"][number];
    direct.started.mockImplementation(async (id) => startedLogOf(history, id));

    const loading = await loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(loading.overview.started.fromLastRun).toBe(true);
    expect(loading.overview.started.locatedDirectly).toBeUndefined();
    expect(direct.started).not.toHaveBeenCalled();
    release();
    await loading.startedCheck;
  });
});

describe("an emergency upgrade's execution, while the index reads the history", () => {
  it("is located directly on a page, labelled, and confirmed by the index", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: executionTx(history, id),
      blockNumber: emergency.block,
    }));

    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    const first = await loading.executedFirst;
    expect(first).toMatchObject({
      txHash: executionTx(history, emergency.id),
      blockNumber: emergency.block.toString(),
      locatedDirectly: true,
    });
    expect(first?.calls).toHaveLength(1);
    // The index's execution (JSON's, and what the signatures compare with) waits for the index.
    expect(await settles(loading.executed)).toBe(false);
    expect(await settles(loading.executedCheck)).toBe(false);

    release();
    const confirmed = await loading.executedCheck;
    expect(confirmed?.txHash).toBe(first?.txHash);
    expect(confirmed?.locatedDirectly).toBeUndefined();
    expect((await loading.executed)?.locatedDirectly).toBeUndefined();
  });

  it("that the index contradicts fails the page's check", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    const other = history.emergencies[5] as PuhHistory["emergencies"][number];
    // Another transaction (in another block) than the history's for this id, with the same calls.
    const elsewhere = txHash({ blockNumber: other.block, logIndex: 3 });
    state.transactions.set(elsewhere.toLowerCase(), calldata(4));
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: elsewhere,
      blockNumber: other.block,
    }));

    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    expect((await loading.executedFirst)?.locatedDirectly).toBe(true);
    release();
    await expect(loading.executedCheck).rejects.toBeInstanceOf(IndexIntegrityError);
    await expect(loading.executedCheck).rejects.toThrow(/located directly/);
    // The index's own execution is unaffected.
    expect((await loading.executed)?.txHash).toBe(executionTx(history, emergency.id));
  });

  /** What the page shows once the index has answered, when the direct event could not stand in. */
  async function leftToTheIndex(
    loading: Awaited<ReturnType<typeof loadEmergencyUpgrade>>,
    release: () => void,
    expected: Hex
  ) {
    // Nothing unconfirmed is shown (no negative, no error): the page waits for the index.
    expect(await settles(loading.executedFirst)).toBe(false);
    release();
    const first = await loading.executedFirst;
    expect(first?.txHash).toBe(expected);
    expect(first?.idMatches).toBe(true);
    expect(first?.locatedDirectly).toBeUndefined();
    expect(first?.fromLastRun).toBeUndefined();
    // Nothing to confirm, and the board's re-checks are the index's execution's.
    expect(await loading.executedCheck).toBeNull();
    const executed = await loading.executed;
    expect(executed?.txHash).toBe(expected);
    const historical = await loading.executedHistorical;
    expect(historical?.historical?.block).toBe(
      (BigInt(executed?.blockNumber ?? 0) - 1n).toString()
    );
  }

  it("whose transaction is not an execution sent to the board leaves the page to the index", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: `0x${"77".repeat(32)}` as Hex,
      blockNumber: emergency.block,
    }));
    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    await leftToTheIndex(loading, release, executionTx(history, emergency.id));
  });

  it("whose transaction cannot be read leaves the page to the index", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    const tx = executionTx(history, emergency.id);
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: tx,
      blockNumber: emergency.block,
    }));
    // Reads of the transaction fail (a transient upstream error) while the index reads.
    state.failing.set(tx.toLowerCase(), Number.POSITIVE_INFINITY);
    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    await leftToTheIndex(
      loading,
      () => {
        state.failing.delete(tx.toLowerCase());
        release();
      },
      tx
    );
  });

  it("is read alongside governance, its transaction too, and an early failed read is read again", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    const tx = executionTx(history, emergency.id);
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: tx,
      blockNumber: emergency.block,
    }));
    let releaseGovernance!: () => void;
    gov.held = new Promise((resolve) => {
      releaseGovernance = () => resolve(GOVERNANCE);
    });
    // The first read of the transaction fails (a transient upstream error).
    state.failing.set(tx.toLowerCase(), 1);
    const loading = loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    await vi.waitFor(() => expect(state.txReads).toContain(tx.toLowerCase()));
    expect(await settles(loading)).toBe(false);
    releaseGovernance();
    const first = await (await loading).executedFirst;
    expect(first).toMatchObject({ txHash: tx, locatedDirectly: true, idMatches: true });
    expect(state.txReads.filter((h) => h === tx.toLowerCase())).toHaveLength(2);
    release();
    expect((await (await loading).executedCheck)?.txHash).toBe(tx);
  });

  it("of another emergency upgrade (its calls hash to another id) is never shown for this id", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    const other = history.emergencies[5] as PuhHistory["emergencies"][number];
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: executionTx(history, other.id),
      blockNumber: other.block,
    }));
    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    await leftToTheIndex(loading, release, executionTx(history, emergency.id));
  });

  it("shows its calls before the board's re-checks (archive reads) are in", async () => {
    const { history, release, releaseCalls } = upstream({
      holdCall: (call) => call.method === "eth_getBalance",
    });
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: executionTx(history, id),
      blockNumber: emergency.block,
    }));
    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    const first = await loading.executedFirst;
    expect(first).toMatchObject({ locatedDirectly: true, idMatches: true });
    expect(first?.calls).toHaveLength(1);
    expect(first && "historical" in first).toBe(false);
    expect(await settles(loading.executedHistorical)).toBe(false);
    releaseCalls();
    const historical = await loading.executedHistorical;
    expect(historical?.historical?.block).toBe((emergency.block - 1n).toString());
    release();
    expect((await loading.executedCheck)?.txHash).toBe(first?.txHash);
  });

  it("is never located directly for JSON", async () => {
    const { history, release } = upstream();
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: executionTx(history, id),
      blockNumber: emergency.block,
    }));

    const loading = await loadEmergencyUpgrade(emergency.id);
    expect(loading.executedFirst).toBe(loading.executed);
    expect(loading.executedCheck).toBeNull();
    expect(await settles(loading.executed)).toBe(false);
    release();
    expect((await loading.executed)?.locatedDirectly).toBeUndefined();
    expect(direct.emergency).not.toHaveBeenCalled();
  });

  it("comes from the last run's history on a page, labelled, and is confirmed by the index", async () => {
    const { history, release } = upstream({ holdBelow: SAVED });
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    seedLastRun(history);
    direct.emergency.mockImplementation(async (id) => ({
      id,
      txHash: executionTx(history, id),
      blockNumber: emergency.block,
    }));

    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    const first = await loading.executedFirst;
    expect(first).toMatchObject({
      txHash: executionTx(history, emergency.id),
      blockNumber: emergency.block.toString(),
      fromLastRun: true,
    });
    expect(first?.locatedDirectly).toBeUndefined();
    expect(direct.emergency).not.toHaveBeenCalled();
    expect(await settles(loading.executedCheck)).toBe(false);
    release();
    expect((await loading.executedCheck)?.fromLastRun).toBeUndefined();
  });

  it("from a last run's history the index contradicts fails the page's check", async () => {
    const { history, release } = upstream({ holdBelow: SAVED });
    const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
    // The last run saved the execution under another log (and so another transaction).
    seedLastRun(history, (log) =>
      log.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted &&
      log.topics[1]?.toLowerCase() === emergency.id.toLowerCase()
        ? { ...log, logIndex: 5 }
        : log
    );

    // That transaction exists too, carrying the same calls.
    const saved = txHash({ blockNumber: emergency.block, logIndex: 5 });
    state.transactions.set(saved.toLowerCase(), calldata(4));

    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    const first = await loading.executedFirst;
    expect(first?.fromLastRun).toBe(true);
    expect(first?.txHash).toBe(saved);
    release();
    await expect(loading.executedCheck).rejects.toBeInstanceOf(IndexIntegrityError);
    await expect(loading.executedCheck).rejects.toThrow(/history from the last run/);
  });

  it.each([
    ["is not an execution sent to the board", false],
    ["cannot be read", true],
  ])(
    "from a last run's history whose transaction %s leaves the page to the index",
    async (_, transient) => {
      const { history, release } = upstream({ holdBelow: SAVED });
      const emergency = history.emergencies[4] as PuhHistory["emergencies"][number];
      // The last run saved the execution under another log (and so another transaction).
      seedLastRun(history, (log) =>
        log.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted &&
        log.topics[1]?.toLowerCase() === emergency.id.toLowerCase()
          ? { ...log, logIndex: 5 }
          : log
      );
      const saved = txHash({ blockNumber: emergency.block, logIndex: 5 });
      // Either no execution at all, or one whose reads fail while the index reads the history.
      if (transient) {
        state.transactions.set(saved.toLowerCase(), calldata(4));
        state.failing.set(saved.toLowerCase(), Number.POSITIVE_INFINITY);
      }
      const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
      await leftToTheIndex(loading, release, executionTx(history, emergency.id));
    }
  );

  it("this run has read above the last run's history is not labelled as from the last run", async () => {
    const pre = puhHistory(DEPLOY, FINAL);
    const last = pre.emergencies[pre.emergencies.length - 1] as PuhHistory["emergencies"][number];
    // The last run's history ends just before the newest execution; this run reads above it
    // first, and the rest of its backfill is held.
    const savedTo = last.block - 1n;
    const { history, release } = upstream({ holdBelow: savedTo });
    const emergency = history.emergencies[
      history.emergencies.length - 1
    ] as PuhHistory["emergencies"][number];
    const saved = history.logs
      .filter((l) => l.blockNumber <= savedTo)
      .map((l) => rawLog({ address: PUH }, l));
    puhIndex().seedProvisional({
      chainId: 1,
      address: PUH,
      deployBlock: DEPLOY,
      finalizedTo: savedTo,
      logs: parseLogs(saved, { addresses: [PUH] }, DEPLOY, savedTo),
    });

    const loading = await loadEmergencyUpgrade(emergency.id, { freshness: "page" });
    const first = await loading.executedFirst;
    expect(first?.txHash).toBe(executionTx(history, emergency.id));
    expect(first?.fromLastRun).toBeUndefined();
    expect(first?.locatedDirectly).toBeUndefined();
    expect(await loading.executedCheck).toBeNull();
    expect(direct.emergency).not.toHaveBeenCalled();
    release();
    expect((await loading.executed)?.txHash).toBe(first?.txHash);
  });

  it("is not looked up for an emergency upgrade that has not been executed", async () => {
    const { release } = upstream();
    release();
    const id = `0x${"ab".repeat(32)}` as Hex;
    state.status.set(id, [0, false]);
    const loading = await loadEmergencyUpgrade(id, { freshness: "page" });
    expect(await loading.executedFirst).toBeNull();
    expect(loading.executedCheck).toBeNull();
    expect(direct.emergency).not.toHaveBeenCalled();
  });
});

describe("the emergency list in a fresh process", () => {
  it("lists executions without waiting for governance (only the pending ids need it)", async () => {
    const { history, release } = upstream();
    release();
    let releaseGovernance!: () => void;
    gov.held = new Promise((resolve) => {
      releaseGovernance = () => resolve(GOVERNANCE);
    });
    const loading = await loadEmergencyList({ allHistory: true, freshness: "page" });
    const first = await loading.executedFirst;
    expect(first.items.map((e) => e.id)).toEqual(history.emergencies.map((e) => e.id).reverse());
    expect(await settles(loading.pending)).toBe(false);
    releaseGovernance();
    expect((await loading.pending).pending).toEqual([]);
  });
});

describe("the narrow UpgradeStarted read", () => {
  const ID = `0x${"12".repeat(32)}` as Hex;
  const OTHER = `0x${"34".repeat(32)}` as Hex;
  const log = (change: Partial<Log> = {}): Log =>
    ({
      address: PUH,
      topics: [PUH_TOPICS.UpgradeStarted, ID],
      data: "0x",
      blockNumber: 100n,
      logIndex: 0,
      transactionHash: `0x${"ab".repeat(32)}`,
      removed: false,
      ...change,
    }) as Log;
  const asked = { address: PUH, id: ID, fromBlock: 100n, toBlock: 116n };

  it("keeps only the handler's UpgradeStarted log of the id, within the blocks asked", () => {
    expect(narrowStartedLog([log()], asked)).not.toBeNull();
    expect(
      narrowStartedLog([log({ topics: [PUH_TOPICS.UpgradeStarted, OTHER] })], asked)
    ).toBeNull();
    expect(narrowStartedLog([log({ topics: [PUH_TOPICS.UpgradeExecuted, ID] })], asked)).toBeNull();
    expect(
      narrowStartedLog([log({ address: "0x0000000000000000000000000000000000000001" })], asked)
    ).toBeNull();
    expect(narrowStartedLog([log({ removed: true })], asked)).toBeNull();
    expect(narrowStartedLog([log({ blockNumber: 99n })], asked)).toBeNull();
    expect(narrowStartedLog([log({ blockNumber: 117n })], asked)).toBeNull();
    // The right one after a wrong one.
    const right = log({ logIndex: 2 });
    expect(
      narrowStartedLog([log({ topics: [PUH_TOPICS.UpgradeStarted, OTHER] }), right], asked)
    ).toBe(right);
  });
});
