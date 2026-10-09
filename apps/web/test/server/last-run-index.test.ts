import { createLane } from "@/.server/chain/jsonrpc";
import {
  IndexIncomplete,
  type IndexHead,
  type IndexedLog,
  type ProvisionalOutcome,
  createLogIndex,
  parseLogs,
} from "@/.server/chain/log-index";
import { InvalidLogsAnswer } from "@/.server/chain/log-index";
import { type Address, type Hex, numberToHex, pad } from "viem";
import { describe, expect, it } from "vitest";
import {
  type ChainLog,
  type FakeChainOptions,
  blockHash,
  fakeChain,
  rawLog,
  spreadLogs,
} from "../support/fake-chain";
import { type FakeCall, type FakePost, fakeJsonRpc } from "../support/fake-jsonrpc";

// A log index seeded with the history the last run saved (persist/chain-cache.ts): pages may read
// it (and this run's reads above it) while this run's backfill has not covered it yet, JSON never
// does, and once the backfill covers its range the two are compared: the same logs is
// "verified", anything else (a log added, removed or changed) a "mismatch".

const ADDRESS: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
// The last run's boundary: this run's is 3,000 blocks further.
const SAVED = FINAL - 3_000n;
const CAP = 10_000n;
const URL_ = "https://rpc.example.invalid/v3/0123456789abcdef0123456789abcdef";

const word = (n: number | bigint) => pad(numberToHex(n), { size: 32 }) as Hex;

/** The chain: 98 logs from the deployment to FINAL (one at FINAL), and one in the tail. */
const chainLogs = (): ChainLog[] => [
  ...spreadLogs(98, DEPLOY, FINAL),
  { blockNumber: FINAL + 5n, logIndex: 0, topics: [word(7), word(99)] },
];

/** The history up to `to` as the last run would have saved it (raw, then checked on load). */
function savedHistory(logs: ChainLog[], to = SAVED): { finalizedTo: bigint; logs: IndexedLog[] } {
  const raw = logs.filter((l) => l.blockNumber <= to).map((l) => rawLog({ address: ADDRESS }, l));
  return { finalizedTo: to, logs: parseLogs(raw, { addresses: [ADDRESS] }, DEPLOY, to) };
}

const eth = (call: FakeCall) => call.params[0] as { fromBlock: Hex; toBlock: Hex };

/** A backfill chunk at or below `boundary` (not the bridge above it, not the tail). */
function isHeldChunk(call: FakeCall, boundary: bigint) {
  if (call.method !== "eth_getLogs") return false;
  const from = BigInt(eth(call).fromBlock);
  const to = BigInt(eth(call).toBlock);
  return to <= FINAL && to - from <= CAP && from <= boundary;
}

/** `holdBelow`: backfill chunks reaching down to it wait for `release()` (default SAVED). */
function setup(chainOptions: Partial<FakeChainOptions> = {}, { holdBelow = SAVED } = {}) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = fakeChain({ address: ADDRESS, logs: chainLogs(), cap: CAP, ...chainOptions });
  // The backfill's chunks wait for the test; the probe (too large: a range error), the bridge
  // and the tail are answered at once.
  const intercept = async (post: FakePost) => {
    if (post.calls.some((call) => isHeldChunk(call, holdBelow))) await gate;
    return undefined;
  };
  const fake = fakeJsonRpc({ handle: (call) => chain.handle(call), intercept });
  const quick = fakeJsonRpc({ handle: (call) => chain.handle(call), intercept });
  const lane = createLane({
    url: URL_,
    label: "l1-history",
    maxBatch: 25,
    maxInFlight: 8,
    backoffMs: 1,
    fetch: fake.fetch as typeof fetch,
  });
  // As the handler's index: the tail and the bridge do not queue behind the backfill's chunks.
  const quickLane = createLane({
    url: URL_,
    label: "l1-call",
    maxBatch: 20,
    maxInFlight: 8,
    backoffMs: 1,
    fetch: quick.fetch as typeof fetch,
  });
  const head: { current: IndexHead } = {
    current: { head: { number: HEAD, hash: blockHash(HEAD) }, safe: FINAL },
  };
  const index = createLogIndex({
    label: "test",
    lane,
    quickLane,
    address: ADDRESS,
    deployBlock: DEPLOY,
    head: async () => head.current,
    retryDelayMs: 1,
    retryMs: 0,
  });
  const outcomes: ProvisionalOutcome[] = [];
  const onOutcome = (outcome: ProvisionalOutcome) => outcomes.push(outcome);
  return { chain, fake, quick, index, head, release, outcomes, onOutcome };
}

/** The eth_getLogs ranges sent through a fake. */
const getLogsRanges = (fake: ReturnType<typeof fakeJsonRpc>) =>
  fake.posts
    .flatMap((post) => post.calls)
    .filter((call) => call.method === "eth_getLogs")
    .map((call): [bigint, bigint] => [BigInt(eth(call).fromBlock), BigInt(eth(call).toBlock)]);

const keys = (logs: readonly IndexedLog[]) => logs.map((l) => `${l.blockNumber}:${l.logIndex}`);
const expected = (logs: ChainLog[], from = DEPLOY, to = HEAD) =>
  logs
    .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
    .map((l) => `${l.blockNumber}:${l.logIndex}`);

describe("a history seeded from the last run", () => {
  it("answers a page from it while the backfill is held, labelled, and JSON waits for the backfill", async () => {
    const ctx = setup();
    const logs = chainLogs();
    expect(ctx.index.seedProvisional(savedHistory(logs), ctx.onOutcome)).toBe(true);
    expect(ctx.index.status().provisional).toEqual({
      state: "provisional",
      finalizedTo: SAVED.toString(),
      logs: logs.filter((l) => l.blockNumber <= SAVED).length,
    });

    const page = await ctx.index.read({ provisional: true });
    expect(page.provisionalTo).toBe(SAVED);
    expect(keys(page.logs)).toEqual(expected(logs));
    // Above the saved history, only this run's reads: the bridge to the boundary and the tail.
    expect(ctx.chain.ranges()).toContainEqual([SAVED + 1n, FINAL]);
    expect(ctx.chain.ranges()).toContainEqual([FINAL + 1n, HEAD]);
    expect(ctx.index.status().state).toBe("backfilling");

    // A range above the saved history is this run's own answer: not labelled.
    const recent = await ctx.index.read({ provisional: true, fromBlock: SAVED + 1n });
    expect(recent.provisionalTo).toBeNull();
    expect(keys(recent.logs)).toEqual(expected(logs, SAVED + 1n));

    // JSON (no `provisional`) never answers from it: it waits for this run's backfill.
    await expect(ctx.index.read({ waitMs: 30 })).rejects.toBeInstanceOf(IndexIncomplete);
    await expect(ctx.index.logs({ fromBlock: DEPLOY, waitMs: 30 })).rejects.toBeInstanceOf(
      IndexIncomplete
    );
    expect(ctx.outcomes).toEqual([]);

    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.outcomes).toEqual(["verified"]);
    expect(ctx.index.status()).toMatchObject({
      state: "ready",
      provisional: { state: "verified", finalizedTo: SAVED.toString() },
    });
    // Verified: this run's index answers everything from now on.
    const after = await ctx.index.read({ provisional: true });
    expect(after.provisionalTo).toBeNull();
    expect(keys(after.logs)).toEqual(expected(logs));
    expect(keys(await ctx.index.logs())).toEqual(expected(logs));
  });

  it.each([
    [
      "an extra log",
      (saved: IndexedLog[]) => {
        const extra = { ...(saved[10] as IndexedLog), blockNumber: SAVED - 7n, logIndex: 4 };
        return [...saved, extra].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
      },
    ],
    ["a removed log", (saved: IndexedLog[]) => saved.filter((_, i) => i !== 40)],
    [
      "a changed log",
      (saved: IndexedLog[]) =>
        saved.map((log, i) => (i === 20 ? { ...log, transactionHash: word(0xbad) } : log)),
    ],
    [
      "a log with other data",
      (saved: IndexedLog[]) =>
        saved.map((log, i) =>
          i === 30 ? ({ ...log, topics: [word(1), word(0xbad)] } as IndexedLog) : log
        ),
    ],
    [
      "a log at another transaction index",
      (saved: IndexedLog[]) =>
        saved.map((log, i) =>
          i === 50 ? { ...log, transactionIndex: log.transactionIndex + 1 } : log
        ),
    ],
  ])("is a mismatch with %s, found once the backfill covers it, and dropped", async (_, tamper) => {
    const ctx = setup();
    const logs = chainLogs();
    const saved = savedHistory(logs);
    expect(ctx.index.seedProvisional({ ...saved, logs: tamper(saved.logs) }, ctx.onOutcome)).toBe(
      true
    );
    // Until then a page shows it (labelled), whatever it says.
    expect((await ctx.index.read({ provisional: true })).provisionalTo).toBe(SAVED);

    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.outcomes).toEqual(["mismatch"]);
    expect(ctx.index.status().provisional?.state).toBe("mismatch");
    // Dropped: pages get this run's history.
    const page = await ctx.index.read({ provisional: true });
    expect(page.provisionalTo).toBeNull();
    expect(keys(page.logs)).toEqual(expected(logs));
  });

  it("checks a seed that arrives after the backfill at once", async () => {
    const ctx = setup();
    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.index.seedProvisional(savedHistory(chainLogs()), ctx.onOutcome)).toBe(true);
    expect(ctx.outcomes).toEqual(["verified"]);
    // Only one seed per index.
    expect(ctx.index.seedProvisional(savedHistory(chainLogs()), ctx.onOutcome)).toBe(false);
  });

  it("checks a seed whose last block is above this run's boundary once the boundary reaches it", async () => {
    const logs = [...chainLogs(), { blockNumber: FINAL + 8n, logIndex: 1, topics: [word(8)] }];
    const ctx = setup({ logs });
    expect(ctx.index.seedProvisional(savedHistory(logs, FINAL + 10n), ctx.onOutcome)).toBe(true);
    // Not used for a page at a head whose boundary is below its last block: the page waits for
    // the backfill like JSON.
    await expect(ctx.index.read({ provisional: true, waitMs: 30 })).rejects.toBeInstanceOf(
      IndexIncomplete
    );
    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.outcomes).toEqual([]);
    ctx.head.current = {
      head: { number: HEAD + 20n, hash: blockHash(HEAD + 20n) },
      safe: FINAL + 20n,
    };
    await ctx.index.syncHead();
    expect(ctx.outcomes).toEqual(["verified"]);
  });

  it("never answers a page with a log twice when its last block was above this run's first boundary", async () => {
    // Two logs between this run's first boundary (FINAL) and the seed's last block.
    const logs = [...chainLogs(), { blockNumber: FINAL + 8n, logIndex: 1, topics: [word(8)] }];
    const ctx = setup({ logs });
    expect(ctx.index.seedProvisional(savedHistory(logs, FINAL + 10n), ctx.onOutcome)).toBe(true);
    // A first page read at a boundary below the seed's last block anchors there, and waits like
    // JSON (no bridge from below the seed).
    await expect(ctx.index.read({ provisional: true, waitMs: 30 })).rejects.toBeInstanceOf(
      IndexIncomplete
    );
    // The boundary passes the seed's last block while the backfill is still held.
    ctx.head.current = {
      head: { number: HEAD + 20n, hash: blockHash(HEAD + 20n) },
      safe: FINAL + 20n,
    };
    await ctx.index.syncHead();
    expect(ctx.index.status().state).toBe("backfilling");
    const page = await ctx.index.read({ provisional: true });
    expect(page.provisionalTo).toBe(FINAL + 10n);
    expect(keys(page.logs)).toEqual(expected(logs, DEPLOY, HEAD + 20n));
    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.outcomes).toEqual(["verified"]);
  });

  it("leaves a wide gap above an old seed to the backfill: no bridge read beside verdict calls", async () => {
    // A file from about 70 days ago: 500,000 blocks below this run's boundary, 50 chunks.
    const old = FINAL - 500_000n;
    const logs = chainLogs();
    const ctx = setup({}, { holdBelow: old });
    expect(ctx.index.seedProvisional(savedHistory(logs, old), ctx.onOutcome)).toBe(true);
    const page = await ctx.index.read({ provisional: true });
    expect(page.provisionalTo).toBe(old);
    expect(keys(page.logs)).toEqual(expected(logs));
    // The quick lane (the verdict calls' lane) read only the tail; the gap came from the
    // backfill's newest chunks on the history lane, read once.
    expect(getLogsRanges(ctx.quick)).toEqual([[FINAL + 1n, HEAD]]);
    const history = getLogsRanges(ctx.fake).filter(([from, to]) => from > old && to <= FINAL);
    expect(new Set(history.map(String)).size).toBe(history.length);
    // A query above the seed is this run's own, as without it.
    const recent = await ctx.index.read({ provisional: true, fromBlock: old + 1n });
    expect(recent.provisionalTo).toBeNull();
    expect(keys(recent.logs)).toEqual(expected(logs, old + 1n));
    expect(ctx.outcomes).toEqual([]);
    ctx.release();
    await ctx.index.startBackfill();
    expect(ctx.outcomes).toEqual(["verified"]);
  });

  it("reads a narrow gap above a recent seed on its own, once, and only the gap", async () => {
    const ctx = setup();
    const logs = chainLogs();
    ctx.index.seedProvisional(savedHistory(logs), ctx.onOutcome);
    await ctx.index.read({ provisional: true });
    await ctx.index.read({ provisional: true });
    expect(getLogsRanges(ctx.quick)).toEqual([
      [SAVED + 1n, FINAL],
      [FINAL + 1n, HEAD],
    ]);
  });

  it("refuses a seed below the first block, or with a log outside its range or from another address", () => {
    const ctx = setup();
    const saved = savedHistory(chainLogs());
    expect(ctx.index.seedProvisional({ finalizedTo: DEPLOY - 1n, logs: [] })).toBe(false);
    const outside = { ...(saved.logs[5] as IndexedLog), blockNumber: SAVED + 1n };
    expect(ctx.index.seedProvisional({ ...saved, logs: [...saved.logs, outside] })).toBe(false);
    const other = {
      ...(saved.logs[5] as IndexedLog),
      address: "0x0000000000000000000000000000000000000bad" as Address,
    };
    expect(ctx.index.seedProvisional({ ...saved, logs: [other] })).toBe(false);
    expect(ctx.index.status().provisional).toBeNull();
  });

  it("says a seed was dropped unchecked when the index closes, and dropProvisional forgets it", async () => {
    const ctx = setup();
    ctx.index.seedProvisional(savedHistory(chainLogs()), ctx.onOutcome);
    ctx.index.close();
    expect(ctx.outcomes).toEqual(["dropped"]);

    const other = setup();
    other.index.seedProvisional(savedHistory(chainLogs()), other.onOutcome);
    other.index.dropProvisional();
    expect(other.index.status().provisional).toBeNull();
    other.release();
    await other.index.startBackfill();
    expect(other.outcomes).toEqual([]);
  });

  it("has no final snapshot until the history is complete, then the whole of it", async () => {
    const ctx = setup();
    const logs = chainLogs();
    ctx.index.seedProvisional(savedHistory(logs), ctx.onOutcome);
    await ctx.index.read({ provisional: true });
    expect(ctx.index.finalSnapshot()).toBeNull();
    ctx.release();
    await ctx.index.startBackfill();
    const snapshot = ctx.index.finalSnapshot();
    expect(snapshot).toMatchObject({ coveredFrom: DEPLOY, finalizedTo: FINAL });
    expect(keys(snapshot?.logs ?? [])).toEqual(expected(logs, DEPLOY, FINAL));
  });
});

describe("parseLogs", () => {
  const raw = (log: ChainLog) => rawLog({ address: ADDRESS }, log);
  const log: ChainLog = { blockNumber: DEPLOY + 5n, logIndex: 0, topics: [word(1)] };

  it("accepts what eth_getLogs could answer for the range, in order", () => {
    const later: ChainLog = { ...log, blockNumber: DEPLOY + 9n };
    const parsed = parseLogs([raw(later), raw(log)], { addresses: [ADDRESS] }, DEPLOY, SAVED);
    expect(parsed.map((l) => l.blockNumber)).toEqual([DEPLOY + 5n, DEPLOY + 9n]);
  });

  it.each([
    ["not a list", {}],
    ["a removed log", [{ ...raw(log), removed: true }]],
    ["another address", [{ ...raw(log), address: "0x0000000000000000000000000000000000000bad" }]],
    ["a log outside the range", [raw({ ...log, blockNumber: SAVED + 1n })]],
    ["the same log twice", [raw(log), raw(log)]],
    ["a log without its hash", [{ ...raw(log), transactionHash: null }]],
  ])("rejects %s", (_, input) => {
    expect(() => parseLogs(input, { addresses: [ADDRESS] }, DEPLOY, SAVED)).toThrow(
      InvalidLogsAnswer
    );
  });

  it("rejects a topic0 the filter does not keep", () => {
    expect(() =>
      parseLogs([raw(log)], { addresses: [ADDRESS], topic0: [word(2)] }, DEPLOY, SAVED)
    ).toThrow(InvalidLogsAnswer);
  });
});
