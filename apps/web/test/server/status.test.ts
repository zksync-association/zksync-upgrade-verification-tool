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
      logCanary: null,
    }),
  };
});
vi.mock("@/.server/governance", () => ({ governance: () => state.governance?.() }));
vi.mock("@/.server/logs", () => ({ checkLogHistory: async () => ({ status: "ok" }) }));
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({ status: () => state.index, hasCanary: async () => null }),
}));
vi.mock("@/.server/safe-api", () => ({ quota: { limit: null, remaining: null } }));

const { appStatus } = await import("@/.server/status");
const { ConfigError } = await import("@/.server/rpc");

beforeEach(() => {
  state.governance = async () => ({ warnings: [], network: { overrides: [] } });
});

describe("appStatus", () => {
  it("adds sync.index next to the fields it always had", async () => {
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
      sync: { index: state.index },
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
