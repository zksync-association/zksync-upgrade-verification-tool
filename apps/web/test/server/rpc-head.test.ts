import { clearCache, remainingMs } from "@/.server/cache";
import {
  chainHead,
  finalizedBlock,
  lanes,
  latestBlock,
  pollHead,
  resetRpcClients,
  safeBlockNumber,
} from "@/.server/rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockHash, fakeChain } from "../support/fake-chain";
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
  head: { number: bigint; hash?: `0x${string}` } = { number: HEAD }
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
  vi.useRealTimers();
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
    },
    // The head lane asks a read the node failed to answer (-32603 "internal error") again twice,
    // 250 and 750 ms later, before the failure stands: four reads here.
    15_000
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

// The sync engine's head polls: an answer is served (becomes the entry every request reads) only
// when the engine publishes it.
describe("head polls", () => {
  const asked = (fake: ReturnType<typeof upstream>) =>
    fake.posts.map((post) => post.calls.map((call) => call.params[0]));

  it("serves the polled head once published: requests then read it without asking", async () => {
    const fake = upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: true });
    expect(polled).toMatchObject({
      head: { number: HEAD, hash: blockHash(HEAD) },
      finalized: { number: HEAD - 80n },
    });
    // 'latest' and 'finalized' in one batch.
    expect(asked(fake)).toEqual([["latest", "finalized"]]);
    expect(await polled.boundary()).toBe(HEAD - 80n);
    expect(polled.isNewest()).toBe(true);
    expect(polled.publish()).toBe(true);
    expect((await latestBlock()).hash).toBe(blockHash(HEAD));
    expect(await chainHead()).toMatchObject({ head: { number: HEAD }, safe: HEAD - 80n });
    expect(fake.posts).toHaveLength(1);
  });

  it("serves nothing until published: the cached head stays what it was", async () => {
    upstream(HEAD - 80n);
    expect((await latestBlock()).number).toBe(HEAD);
    const fake = upstream(HEAD - 79n, undefined, { number: HEAD + 1n });
    const polled = await pollHead({ withFinalized: false });
    expect(polled.head.number).toBe(HEAD + 1n);
    expect((await latestBlock()).number).toBe(HEAD);
    expect(polled.publish()).toBe(true);
    expect((await latestBlock()).number).toBe(HEAD + 1n);
    expect(fake.posts).toHaveLength(1);
  });

  it("asks only for the head when told to, keeping the last real 'finalized' answer", async () => {
    upstream(HEAD - 80n);
    await pollHead({ withFinalized: true });
    clearCache();
    // 20 blocks later; the node's finalized block moved too, but it is not asked.
    const fake = upstream(HEAD - 60n, undefined, { number: HEAD + 20n });
    const polled = await pollHead({ withFinalized: false });
    expect(polled.finalized).toBeUndefined();
    expect(asked(fake)).toEqual([["latest"]]);
    // The older finalized block is still final: a deeper boundary, never a guess.
    expect(await polled.boundary()).toBe(HEAD - 80n);
    polled.publish();
    expect(await safeBlockNumber()).toBe(HEAD - 80n);
    expect(fake.posts).toHaveLength(1);
  });

  it("asks for 'finalized' anyway when nothing is known about it yet", async () => {
    const fake = upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: false });
    expect(asked(fake)).toEqual([["latest", "finalized"]]);
    expect(polled.finalized).toMatchObject({ number: HEAD - 80n });
  });

  it("keeps a newer head a request read: an older poll answer is never served", async () => {
    upstream(HEAD - 80n, undefined, { number: HEAD + 1n });
    expect((await latestBlock()).number).toBe(HEAD + 1n);
    // The poll reaches a backend one block behind.
    upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: false });
    expect(polled.isNewest()).toBe(false);
    expect(polled.publish()).toBe(false);
    expect(polled.confirm()).toBe(false);
    expect((await latestBlock()).number).toBe(HEAD + 1n);
  });

  it("re-serves a confirmed head for another 4 s without asking, until another head is seen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: true });
    polled.publish();
    vi.setSystemTime(Date.now() + 3_900);
    expect(polled.confirm()).toBe(true);
    vi.setSystemTime(Date.now() + 3_900);
    expect((await latestBlock()).number).toBe(HEAD);
    expect(fake.posts).toHaveLength(1);
    vi.setSystemTime(Date.now() + 200);
    // Expired: a request asks the node again, as without the engine.
    await latestBlock();
    expect(fake.posts).toHaveLength(2);

    // Block HEAD is replaced by another block at the same height: the new hash is the head, and
    // the old poll can no longer confirm its block.
    upstream(HEAD - 80n, undefined, { number: HEAD, hash: blockHash(HEAD, 1) });
    const reorged = await pollHead({ withFinalized: false });
    expect(reorged.isNewest()).toBe(true);
    expect(reorged.publish()).toBe(true);
    expect((await latestBlock()).hash).toBe(blockHash(HEAD, 1));
    expect(polled.confirm()).toBe(false);
    expect((await latestBlock()).hash).toBe(blockHash(HEAD, 1));
  });

  it("never serves an earlier poll's block once a later poll named another block at that height", async () => {
    upstream(HEAD - 80n);
    const orphan = await pollHead({ withFinalized: true });
    // Block HEAD is replaced by another block at the same height, which a later poll names and
    // the engine serves.
    upstream(HEAD - 80n, undefined, { number: HEAD, hash: blockHash(HEAD, 1) });
    const canonical = await pollHead({ withFinalized: false });
    expect(canonical.publish()).toBe(true);
    // The earlier answer (a slow tick finishing late) cannot bring the orphan back.
    expect(orphan.isNewest()).toBe(false);
    expect(orphan.publish()).toBe(false);
    expect(orphan.confirm()).toBe(false);
    expect((await latestBlock()).hash).toBe(blockHash(HEAD, 1));
  });

  it("serves a polled head until 4 s after the node answered, however late it is published", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: true });
    expect(polled.answeredAt).toBe(Date.now());
    vi.setSystemTime(Date.now() + 3_000);
    expect(polled.publish()).toBe(true);
    expect(remainingMs("latest-block")).toBe(1_000);
    vi.setSystemTime(Date.now() + 1_000);
    expect(remainingMs("latest-block")).toBeNull();
    // An answer 4 s old is not served at all.
    expect(polled.publish()).toBe(false);
    expect(remainingMs("latest-block")).toBeNull();
    // A confirmation vouches for the moment it is made: 4 s from then.
    expect(polled.confirm()).toBe(true);
    expect(remainingMs("latest-block")).toBe(4_000);
  });

  it("drops a poll answered after the settings changed", async () => {
    const chain = fakeChain({
      address: "0x0000000000000000000000000000000000000001",
      logs: [],
      head: { number: HEAD },
      finalized: HEAD - 80n,
    });
    const fake = fakeJsonRpc({ handle: (call) => chain.handle(call), delayMs: 20 });
    vi.stubGlobal("fetch", fake.fetch);
    const polling = pollHead({ withFinalized: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    clearCache();
    resetRpcClients();
    // The old settings' lane is closed: its read in flight is aborted.
    await expect(polling).rejects.toThrow();
    upstream(HEAD - 80n, undefined, { number: HEAD + 5n });
    expect((await latestBlock()).number).toBe(HEAD + 5n);
  });

  it("never serves a poll from before a settings change", async () => {
    upstream(HEAD - 80n);
    const polled = await pollHead({ withFinalized: true });
    clearCache();
    resetRpcClients();
    expect(polled.isNewest()).toBe(false);
    expect(polled.publish()).toBe(false);
    expect(polled.confirm()).toBe(false);
    const fake = upstream(HEAD - 80n, undefined, { number: HEAD + 5n });
    expect((await latestBlock()).number).toBe(HEAD + 5n);
    expect(fake.posts).toHaveLength(1);
  });

  it("rejects when the head cannot be read, and leaves the cached head alone", async () => {
    upstream(HEAD - 80n);
    (await pollHead({ withFinalized: true })).publish();
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    await expect(pollHead({ withFinalized: false })).rejects.toThrow();
    expect((await latestBlock()).number).toBe(HEAD);
  });

  it("never shares a POST with an eth_call: a slow call holds up no head read", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = fakeChain({
      address: "0x0000000000000000000000000000000000000001",
      logs: [],
      head: { number: HEAD },
      finalized: HEAD - 80n,
    });
    const fake = fakeJsonRpc({
      handle: async (call) => {
        if (call.method !== "eth_call") return chain.handle(call);
        await held;
        return "0x";
      },
    });
    vi.stubGlobal("fetch", fake.fetch);
    // A verdict read the node takes its time over, sent just before the head reads.
    const slow = lanes().call.request("eth_call", [
      { to: "0x0000000000000000000000000000000000000002", data: "0x" },
      "latest",
    ]);
    const heads = Promise.all([pollHead({ withFinalized: true }), latestBlock()]);
    const answer = await Promise.race([
      heads,
      new Promise<"held">((resolve) => setTimeout(() => resolve("held"), 1_000)),
    ]);
    expect(answer).not.toBe("held");
    const [polled, head] = await heads;
    expect(polled.head.number).toBe(HEAD);
    expect(head.number).toBe(HEAD);
    for (const post of fake.posts) {
      const methods = new Set(post.calls.map((call) => call.method));
      expect(methods.has("eth_call") && methods.has("eth_getBlockByNumber")).toBe(false);
    }
    release();
    await slow;
  });
});
