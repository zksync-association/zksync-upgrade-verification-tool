import { l2HistoryLane, lanes, resetRpcClients } from "@/.server/rpc";
import { beforeEach, describe, expect, it, vi } from "vitest";

// network() is read through the cache; this stands in for it so a test can hold it pending.
const state = vi.hoisted(() => ({
  network: undefined as undefined | (() => Promise<{ l2RpcUrl: string | null }>),
  networkReads: 0,
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) => {
      if (key !== "network" || !state.network) return actual.cached(key, ttlMs, compute);
      state.networkReads++;
      return state.network();
    },
  };
});

vi.mock("@/.server/chain/jsonrpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/chain/jsonrpc")>();
  return { ...actual, createLane: vi.fn(actual.createLane) };
});

const { createLane } = await import("@/.server/chain/jsonrpc");

const l2Lanes = () =>
  vi.mocked(createLane).mock.calls.filter(([options]) => options.label === "l2-history");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetRpcClients();
  vi.mocked(createLane).mockClear();
  state.network = undefined;
  state.networkReads = 0;
});

describe("l2HistoryLane", () => {
  it("is null when no L2 RPC is configured, and stays null without reading again", async () => {
    state.network = async () => ({ l2RpcUrl: null });
    expect(await l2HistoryLane()).toBeNull();
    expect(await l2HistoryLane()).toBeNull();
    expect(state.networkReads).toBe(1);
    expect(l2Lanes()).toHaveLength(0);
  });

  it("creates one lane for concurrent callers", async () => {
    state.network = async () => ({ l2RpcUrl: "http://l2.example/" });
    const [a, b] = await Promise.all([l2HistoryLane(), l2HistoryLane()]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(await l2HistoryLane()).toBe(a);
    expect(l2Lanes()).toHaveLength(1);
    expect(a?.stats()).toMatchObject({ label: "l2-history", maxBatch: 20, maxInFlight: 4 });
  });

  it("answers for the new settings when they change while the network is read", async () => {
    const old = deferred<{ l2RpcUrl: string | null }>();
    state.network = () => old.promise;
    const pending = l2HistoryLane();

    // Settings change mid-read: later reads see the new L2 URL.
    resetRpcClients();
    state.network = async () => ({ l2RpcUrl: "http://new-l2.example/" });
    old.resolve({ l2RpcUrl: "http://old-l2.example/" });

    const lane = await pending;
    expect(l2Lanes().map(([options]) => options.url)).toEqual(["http://new-l2.example/"]);
    expect(await l2HistoryLane()).toBe(lane);
    // Not closed: a disallowed method is refused as such, not as "aborted".
    await expect(lane?.request("eth_sendRawTransaction" as never)).rejects.toMatchObject({
      kind: "method-not-allowed",
    });
  });

  it("closes the L2 lane with the L1 lanes on a settings change", async () => {
    state.network = async () => ({ l2RpcUrl: "http://l2.example/" });
    const before = await l2HistoryLane();
    const l1 = lanes();
    resetRpcClients();
    await expect(before?.request("eth_chainId")).rejects.toMatchObject({ kind: "aborted" });
    await expect(l1.history.request("eth_chainId")).rejects.toMatchObject({ kind: "aborted" });
    expect(await l2HistoryLane()).not.toBe(before);
  });
});
