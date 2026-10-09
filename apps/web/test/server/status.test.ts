import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/status (and every page's status) gains `sync.index`, the ProtocolUpgradeHandler log
// index's progress. Additive: every field it had stays as it was.

const state = vi.hoisted(() => ({
  index: {
    state: "backfilling",
    deployBlock: "21788382",
    coveredFrom: "26000000",
    finalizedTo: "26129027",
    headTo: null,
    chunks: { done: 13, total: 435 },
    strategy: "chunked",
    span: "10000",
    logs: 4,
    error: null,
  } as Record<string, unknown>,
  governance: null as null | (() => Promise<unknown>),
  // The standalone canary query, and whether the (ready) index holds the canary log.
  canary: { status: "ok" } as Record<string, unknown>,
  inIndex: null as boolean | null,
  logCanary: null as null | { blockNumber: bigint },
}));

// What the sync engine reports (its own tests cover how).
const ENGINE = vi.hoisted(() => ({
  mode: "window",
  reason: null,
  active: true,
  head: {
    number: "26129107",
    hash: `0x${"ab".repeat(32)}`,
    observedAt: "2026-10-06T07:00:00.000Z",
    confirmedAt: "2026-10-06T07:00:02.000Z",
    ageMs: 1500,
  },
  lastTick: { block: "26129107", ms: 240, failedSteps: [] },
  polls: 12,
  ticks: 3,
}));

// What the L2 governor log index reports (l2-index.test.ts covers how).
const L2_INDEX = vi.hoisted(() => ({
  state: "ready",
  deployBlock: "49077771",
  coveredFrom: "49077771",
  finalizedTo: "72350514",
  headTo: "72352499",
  chunks: { done: 1, total: 1 },
  strategy: "full-range",
  span: null,
  logs: 81,
  error: null,
  governors: [
    "0xb83FF6501214ddF40C91C9565d095400f3F45746",
    "0xEEEa739a8b6fB1b8f703E23C9Be03CeeA643b160",
    "0x76705327e682F2d96943280D99464Ab61219e34f",
  ],
}));

// What the Safe store's sweep reports (safe-store.test.ts covers how).
const SAFE = vi.hoisted(() => ({
  sweeping: true,
  groups: ["securityCouncil", "guardians"],
  oldestFetchedAt: "2026-10-06T06:59:12.000Z",
  budgetUsedThisHour: 40,
  budgetPerHour: 1200,
  paused: null,
  lastError: null,
  failingSafes: 0,
}));

// What the signature-set precompute reports (signatures.test.ts covers how).
const SIGNATURES = vi.hoisted(() => ({
  watched: 3,
  lastRun: {
    block: "26129107",
    trigger: "head",
    sets: 3,
    verified: 2,
    reused: 1,
    skipped: 0,
    failed: 0,
    ms: 180,
  },
}));

// What the chain cache reports (chain-cache.test.ts covers how).
const CACHE = vi.hoisted(() => ({
  state: "verified",
  file: "1-0xd4e56740.json",
  savedAt: "2026-10-06T06:58:00.000Z",
  sizeBytes: 812_345,
  detail: null,
}));

vi.mock("@/.server/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/rpc")>();
  return {
    ConfigError: actual.ConfigError,
    l1: {},
    network: async () => ({
      safeTxServiceUrl: "https://api.safe.global/tx-service/eth",
      l2RpcUrl: "https://mainnet.era.zksync.io",
      clientVersion: "Geth/v1.15",
      logCanary: state.logCanary,
    }),
  };
});
vi.mock("@/.server/governance", () => ({ governance: () => state.governance?.() }));
vi.mock("@/.server/logs", () => ({ checkLogHistory: async () => state.canary }));
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({ status: () => state.index, hasCanary: async () => state.inIndex }),
}));
vi.mock("@/.server/chain/l2-index", () => ({
  l2GovernorIndex: () => ({ status: () => L2_INDEX }),
}));
vi.mock("@/.server/safe-api", () => ({ quota: { limit: null, remaining: null } }));
vi.mock("@/.server/sync/engine", () => ({ syncEngineStatus: () => ENGINE }));
vi.mock("@/.server/safe/store", () => ({ safeStoreStatus: () => SAFE }));
vi.mock("@/.server/signatures", () => ({ signatureSetsStatus: () => SIGNATURES }));
vi.mock("@/.server/persist/chain-cache", () => ({ chainCacheStatus: () => CACHE }));

const { appStatus, logHistoryStatus } = await import("@/.server/status");
const { ConfigError } = await import("@/.server/rpc");

beforeEach(() => {
  state.governance = async () => ({ warnings: [], network: { overrides: [] } });
  state.index.state = "backfilling";
  state.canary = { status: "ok" };
  state.inIndex = null;
  state.logCanary = null;
});

describe("appStatus", () => {
  it("adds sync.index, sync.l2Index, sync.engine, sync.safe, sync.signatures and sync.cache next to the fields it always had", async () => {
    const status = await appStatus();
    expect(status).toEqual({
      ok: true,
      governance: { warnings: [], network: { overrides: [] } },
      logHistory: { status: "ok" },
      safeApi: {
        url: "https://api.safe.global/tx-service/eth",
        withKey: false,
        quota: { limit: null, remaining: null },
      },
      l2RpcConfigured: true,
      clientVersion: "Geth/v1.15",
      sync: {
        index: state.index,
        l2Index: L2_INDEX,
        engine: ENGINE,
        safe: SAFE,
        signatures: SIGNATURES,
        cache: CACHE,
      },
    });
    // JSON-safe as served: strings and numbers only.
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
  });

  it("keeps the error shape unchanged", async () => {
    state.governance = async () => {
      throw new ConfigError("No pinned ProtocolUpgradeHandler");
    };
    expect(await appStatus()).toEqual({
      ok: false,
      error: "No pinned ProtocolUpgradeHandler",
      hint: "Check the environment variables in the README.",
    });
  });
});

describe("logHistoryStatus", () => {
  const error = { status: "error", message: "429 Too Many Requests" };
  const missing = { status: "missing", blockNumber: "21788382" };

  it.each([
    // [canary, index state, canary in the index, expected]
    [{ status: "ok" }, "backfilling", null, { status: "ok" }],
    [error, "backfilling", null, error],
    // The index is ready and holds the canary log: that does not hide a failed canary query.
    [error, "ready", true, error],
    [{ status: "ok" }, "ready", true, { status: "ok" }],
    // The worse view wins: a ready index without the canary log means lists can be incomplete.
    [{ status: "ok" }, "ready", false, missing],
    [error, "ready", false, missing],
  ])("canary %j, index %s (canary in it: %s) → %j", async (canary, index, inIndex, expected) => {
    state.logCanary = { blockNumber: 21_788_382n };
    state.canary = canary;
    state.index.state = index;
    state.inIndex = inIndex;
    expect(await logHistoryStatus()).toEqual(expected);
  });
});
