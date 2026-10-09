import { clearCache } from "@/.server/cache";
import {
  chainHead,
  finalizedBlock,
  latestBlock,
  resetRpcClients,
  safeBlockNumber,
} from "@/.server/rpc";
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

/**
 * A node at HEAD whose 'finalized' block is `finalized`. `finalizedError` answers 'finalized'
 * instead: always, or (a function) per 'finalized' request, counted from 0.
 */
function upstream(
  finalized: bigint | null,
  finalizedError?: FakeRpcError | ((n: number) => FakeRpcError | undefined),
  head: { number: bigint } = { number: HEAD }
) {
  const chain = fakeChain({
    address: "0x0000000000000000000000000000000000000001",
    logs: [],
    head,
    finalized,
  });
  let asked = 0;
  const fake = fakeJsonRpc({
    handle: (call) => {
      if (call.method !== "eth_getBlockByNumber" || call.params[0] !== "finalized")
        return chain.handle(call);
      const error = typeof finalizedError === "function" ? finalizedError(asked) : finalizedError;
      asked++;
      return error ?? chain.handle(call);
    },
  });
  vi.stubGlobal("fetch", fake.fetch);
  return Object.assign(fake, { finalizedAsked: () => asked });
}

beforeEach(() => {
  clearCache();
  // A fresh settings generation: no finalized block known from an earlier test.
  resetRpcClients();
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
    [-32601, "the method eth_getBlockByNumber does not support this tag"],
    [-39001, "Unknown block"],
    [-32004, "block tag 'finalized' is not supported"],
  ])("treats %i %s as an unknown 'finalized' tag: F = head − 64", async (code, message) => {
    upstream(HEAD - 200n, new FakeRpcError(code, message));
    expect(await finalizedBlock()).toBeNull();
    expect(await safeBlockNumber()).toBe(HEAD - 64n);
  });

  it.each([
    [-32603, "internal error"],
    [-32000, "header not found"],
    [-32000, "finalized block not found"],
    [-32000, "Received invalid block tag finalized. Latest block number is 1"],
  ])(
    "on %i %s for 'finalized', the head still answers and F is never relaxed",
    async (code, message) => {
      // The true boundary is head − 200: head − 64 would cache 136 unfinalized blocks forever.
      const fake = upstream(HEAD - 200n, new FakeRpcError(code, message));
      expect((await latestBlock()).number).toBe(HEAD);
      await expect(chainHead()).rejects.toThrow(message);
      await expect(safeBlockNumber()).rejects.toThrow(message);
      await expect(finalizedBlock()).rejects.toThrow(message);
      // The head was read once; each boundary read asked 'finalized' afresh.
      expect(fake.posts.filter((p) => p.calls.some((c) => c.params[0] === "latest"))).toHaveLength(
        1
      );
    }
  );

  it("falls back to the last finalized block known when a later 'finalized' read fails", async () => {
    upstream(HEAD - 70n);
    expect(await safeBlockNumber()).toBe(HEAD - 70n);
    // 100 blocks later the node fails 'finalized': F stays at the last real answer (deeper than
    // head − 64), never the new head − 64.
    clearCache();
    upstream(HEAD + 30n, new FakeRpcError(-32603, "internal error"), { number: HEAD + 100n });
    expect((await latestBlock()).number).toBe(HEAD + 100n);
    expect(await safeBlockNumber()).toBe(HEAD - 70n);
    expect((await finalizedBlock())?.number).toBe(HEAD - 70n);
  });

  it("reads 'finalized' once more when it failed and none is known", async () => {
    const fake = upstream(HEAD - 90n, (n) =>
      n === 0 ? new FakeRpcError(-32603, "internal error") : undefined
    );
    const [first, second] = await Promise.all([chainHead(), safeBlockNumber()]);
    expect(first.safe).toBe(HEAD - 90n);
    expect(second).toBe(HEAD - 90n);
    // The batch, then one shared re-read.
    expect(fake.finalizedAsked()).toBe(2);
    // Known from now on: no more re-reads while the cached head lasts.
    expect(await safeBlockNumber()).toBe(HEAD - 90n);
    expect(fake.finalizedAsked()).toBe(2);
  });

  it("forgets the known finalized block when the settings change", async () => {
    upstream(HEAD - 70n);
    expect(await safeBlockNumber()).toBe(HEAD - 70n);
    clearCache();
    resetRpcClients();
    upstream(HEAD - 70n, new FakeRpcError(-32603, "internal error"));
    await expect(safeBlockNumber()).rejects.toThrow("internal error");
  });

  it("uses the fork block on dev nodes", async () => {
    upstream(HEAD - 80n);
    state.network = { isDevNode: true, forkBlock: 21_000_000n };
    expect(await safeBlockNumber()).toBe(21_000_000n);
    state.network = { isDevNode: true, forkBlock: null };
    expect(await safeBlockNumber()).toBe(-1n);
  });

  it("answers the head and the fork block on dev nodes even when 'finalized' fails", async () => {
    upstream(HEAD - 80n, new FakeRpcError(-32603, "internal error"));
    state.network = { isDevNode: true, forkBlock: 21_000_000n };
    expect((await latestBlock()).number).toBe(HEAD);
    expect(await chainHead()).toMatchObject({ safe: 21_000_000n });
  });

  it("fails rather than guessing when the head cannot be read", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    await expect(latestBlock()).rejects.toThrow();
  });
});
