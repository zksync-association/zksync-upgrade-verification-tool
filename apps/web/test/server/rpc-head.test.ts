import { clearCache } from "@/.server/cache";
import { chainHead, finalizedBlock, latestBlock, safeBlockNumber } from "@/.server/rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "../support/fake-chain";
import { FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

// The head and the finality boundary: 'latest' and 'finalized' in one JSON-RPC batch, and
// F = min(head − 64, finalized) (the fork block on dev nodes).

const state = vi.hoisted(() => ({
  network: { isDevNode: false, forkBlock: null as bigint | null },
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

const HEAD = 26_129_107n;

function upstream(finalized: bigint | null, finalizedError?: FakeRpcError) {
  const chain = fakeChain({
    address: "0x0000000000000000000000000000000000000001",
    logs: [],
    head: { number: HEAD },
    finalized,
  });
  const fake = fakeJsonRpc({
    handle: (call) =>
      finalizedError && call.method === "eth_getBlockByNumber" && call.params[0] === "finalized"
        ? finalizedError
        : chain.handle(call),
  });
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

beforeEach(() => {
  clearCache();
  state.network = { isDevNode: false, forkBlock: null };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chain head", () => {
  it("reads 'latest' and 'finalized' in one batch, and caches both", async () => {
    const fake = upstream(HEAD - 80n);
    const [latest, finalized] = await Promise.all([latestBlock(), finalizedBlock()]);
    expect(latest.number).toBe(HEAD);
    expect(latest.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(latest.timestamp).toBeGreaterThan(0n);
    expect(finalized?.number).toBe(HEAD - 80n);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.batch).toBe(true);
    expect(fake.posts[0]?.calls.map((call) => [call.method, call.params[0]])).toEqual([
      ["eth_getBlockByNumber", "latest"],
      ["eth_getBlockByNumber", "finalized"],
    ]);
    await safeBlockNumber();
    await chainHead();
    expect(fake.posts).toHaveLength(1);
  });

  it("uses the finalized block when it is deeper than head − 64", async () => {
    upstream(HEAD - 94n);
    expect(await safeBlockNumber()).toBe(HEAD - 94n);
    const { head, safe } = await chainHead();
    expect(head.number).toBe(HEAD);
    expect(safe).toBe(HEAD - 94n);
  });

  it("uses head − 64 when the finalized block is newer", async () => {
    upstream(HEAD - 63n);
    expect(await safeBlockNumber()).toBe(HEAD - 64n);
  });

  it("falls back to head − 64 when the node does not know the 'finalized' tag", async () => {
    upstream(null);
    expect(await finalizedBlock()).toBeNull();
    expect(await safeBlockNumber()).toBe(HEAD - 64n);
  });

  it.each([
    [-32602, "invalid argument 0: hex string without 0x prefix"],
    [-32000, "finalized block not found"],
    [-32000, "Received invalid block tag finalized. Latest block number is 1"],
  ])("treats %i %s as an unknown 'finalized' tag", async (code, message) => {
    upstream(HEAD - 200n, new FakeRpcError(code, message));
    expect(await finalizedBlock()).toBeNull();
    expect(await safeBlockNumber()).toBe(HEAD - 64n);
  });

  it.each([
    [-32603, "internal error"],
    [-32000, "header not found"],
  ])(
    "fails the head read on %i %s for 'finalized' instead of relaxing F",
    async (code, message) => {
      // The true boundary is head − 200: head − 64 would cache 136 unfinalized blocks forever.
      upstream(HEAD - 200n, new FakeRpcError(code, message));
      await expect(chainHead()).rejects.toThrow(message);
      await expect(safeBlockNumber()).rejects.toThrow();
    }
  );

  it("uses the fork block on dev nodes", async () => {
    upstream(HEAD - 80n);
    state.network = { isDevNode: true, forkBlock: 21_000_000n };
    expect(await safeBlockNumber()).toBe(21_000_000n);
    state.network = { isDevNode: true, forkBlock: null };
    expect(await safeBlockNumber()).toBe(-1n);
  });

  it("fails rather than guessing when the head cannot be read", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    await expect(latestBlock()).rejects.toThrow();
  });
});
