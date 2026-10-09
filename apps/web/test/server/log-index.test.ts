import { createLane } from "@/.server/chain/jsonrpc";
import {
  IndexClosed,
  IndexIncomplete,
  IndexUnavailable,
  type IndexHead,
  type LogIndexOptions,
  createLogIndex,
} from "@/.server/chain/log-index";
import { LogsUnavailableError } from "@/.server/logs";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  type ChainLog,
  type FakeChainOptions,
  blockHash,
  fakeChain,
  spreadLogs,
} from "../support/fake-chain";
import { type FakeOptions, FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

const ADDRESS: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
// Mainnet: the handler's deployment block to a finalized head, 4,340,646 blocks.
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
const BLOCKS_PER_DAY = 7_200n;
const URL_ = "https://rpc.example.invalid/v3/0123456789abcdef0123456789abcdef";

const history = () => spreadLogs(98, DEPLOY, FINAL);

function setup(
  chainOptions: Partial<FakeChainOptions> & { logs?: ChainLog[] },
  indexOptions: Partial<LogIndexOptions> = {},
  upstream: Omit<FakeOptions, "handle"> & { onAnswer?: () => void } = {}
) {
  const chain = fakeChain({ address: ADDRESS, logs: history(), ...chainOptions });
  const fake = fakeJsonRpc({ ...upstream, handle: (call) => chain.handle(call) });
  const lane = createLane({
    url: URL_,
    label: "l1-history",
    maxBatch: 25,
    maxInFlight: 8,
    backoffMs: 1,
    fetch: (async (input: unknown, init?: RequestInit) => {
      const response = await fake.fetch(input, init);
      upstream.onAnswer?.();
      return response;
    }) as typeof fetch,
  });
  const head: { current: IndexHead } = {
    current: { head: { number: HEAD, hash: blockHash(HEAD) }, safe: FINAL },
  };
  const index = createLogIndex({
    label: "test",
    lane,
    address: ADDRESS,
    deployBlock: DEPLOY,
    head: async () => head.current,
    retryDelayMs: 1,
    retryMs: 0,
    ...indexOptions,
  });
  return { chain, fake, lane, index, head };
}

const inRange = (logs: ChainLog[], from: bigint, to: bigint) =>
  logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);

describe("backfill", () => {
  it("chunks at Infura's 10,000-block cap, newest first, contiguously, at most 8 POSTs at once", async () => {
    const samples: { coveredFrom: string | null; logs: number }[] = [];
    const holder: { index?: ReturnType<typeof setup>["index"] } = {};
    const ctx = setup(
      { cap: 10_000n },
      {},
      {
        delayMs: 5,
        intercept: () => {
          if (holder.index) samples.push(holder.index.status());
          return undefined;
        },
      }
    );
    holder.index = ctx.index;
    await ctx.index.startBackfill();

    const status = ctx.index.status();
    expect(status).toMatchObject({
      state: "ready",
      coveredFrom: DEPLOY.toString(),
      finalizedTo: FINAL.toString(),
      strategy: "chunked",
      span: "10000",
      chunks: { done: 435, total: 435 },
      logs: 98,
      error: null,
    });
    // One full-range attempt, then 435 chunks of 10,000 blocks.
    const ranges = ctx.chain.ranges();
    expect(ranges).toHaveLength(436);
    expect(ranges[0]).toEqual([DEPLOY, FINAL]);
    for (const [from, to] of ranges.slice(1)) expect(to - from).toBeLessThan(10_000n);
    // Address only: never a topics filter.
    for (const query of ctx.chain.queries) {
      expect(query.filter).not.toHaveProperty("topics");
      expect(String(query.filter.address).toLowerCase()).toBe(ADDRESS.toLowerCase());
    }
    // Parallel from both sides: 8 POSTs at once, and nearly every POST a full batch of 25.
    expect(ctx.fake.peak()).toBe(8);
    const sizes = ctx.fake.sizes();
    expect(Math.max(...sizes)).toBe(25);
    expect(sizes.filter((size) => size === 25).length).toBeGreaterThanOrEqual(sizes.length - 3);

    // Coverage only ever grew downward, and always held exactly the chain's logs in its range.
    const chainLogs = history();
    let previous = FINAL + 1n;
    for (const sample of samples) {
      if (sample.coveredFrom === null) continue;
      const from = BigInt(sample.coveredFrom);
      expect(from).toBeLessThanOrEqual(previous);
      expect(sample.logs).toBe(inRange(chainLogs, from, FINAL).length);
      previous = from;
    }
    expect(samples.filter((s) => s.coveredFrom !== null).length).toBeGreaterThan(5);

    const logs = await ctx.index.logs();
    expect(logs).toHaveLength(98);
    expect(logs.map((log) => log.blockNumber)).toEqual(chainLogs.map((log) => log.blockNumber));
  });

  it("covers the last 45 days after the first wave of POSTs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    let answered = 0;
    const ctx = setup(
      { cap: 10_000n },
      { hedgeMs: 60_000 },
      {
        intercept: async () => {
          // POST 0 is the full-range attempt, POSTs 1-8 the first wave.
          if (posts++ > 8) await gate;
          return undefined;
        },
        onAnswer: () => {
          answered++;
        },
      }
    );
    const run = ctx.index.startBackfill();
    while (answered < 9) await new Promise((r) => setTimeout(r, 2));
    await new Promise((r) => setTimeout(r, 10));
    const covered = BigInt(ctx.index.status().coveredFrom ?? FINAL + 1n);
    expect(covered).toBeLessThanOrEqual(FINAL - 45n * BLOCKS_PER_DAY);
    expect(ctx.index.status().state).toBe("backfilling");
    release();
    await run;
    expect(ctx.index.status().state).toBe("ready");
  });

  it("asks a provider without a range cap exactly once", async () => {
    const ctx = setup({});
    await ctx.index.startBackfill();
    expect(ctx.chain.ranges()).toEqual([[DEPLOY, FINAL]]);
    expect(ctx.index.status()).toMatchObject({
      state: "ready",
      strategy: "full-range",
      span: null,
      chunks: { done: 1, total: 1 },
      logs: 98,
    });
  });

  it("halves with one sequential probe when the range error names no cap", async () => {
    const ctx = setup({
      override: ({ from, to }) =>
        to - from + 1n > 600_000n ? new FakeRpcError(-32000, "block range is too wide") : undefined,
    });
    await ctx.index.startBackfill();
    const ranges = ctx.chain.ranges();
    // 4,340,646 -> 2,170,323 -> 1,085,161 -> 542,580 (accepted), each probe after the last.
    const probes = ranges.slice(0, 4).map(([from, to]) => to - from + 1n);
    expect(probes).toEqual([4_340_646n, 2_170_323n, 1_085_161n, 542_580n]);
    for (const [, to] of ranges.slice(0, 4)) expect(to).toBe(FINAL);
    expect(ctx.fake.posts.slice(0, 4).every((post) => post.concurrent === 1)).toBe(true);
    expect(ctx.index.status()).toMatchObject({ state: "ready", span: "542580", logs: 98 });
    expect(await ctx.index.logs()).toHaveLength(98);
  });

  it("keeps backfilling when the query that started it is aborted", async () => {
    const ctx = setup({ cap: 10_000n }, {}, { delayMs: 5 });
    const controller = new AbortController();
    const query = ctx.index.logs({ signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.index.status().state).toBe("backfilling");
    controller.abort(new Error("client went away"));
    await expect(query).rejects.toThrow("client went away");
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "ready", logs: 98 });
    expect(await ctx.index.logs({ waitMs: 0 })).toHaveLength(98);
  });

  it("keeps committed coverage when a chunk keeps failing, and then fetches only the gaps", async () => {
    const failing = { from: FINAL - 261n * 10_000n - 9_999n, to: FINAL - 261n * 10_000n };
    let broken = true;
    const ctx = setup(
      {
        cap: 10_000n,
        override: ({ from, to }) =>
          broken && from === failing.from && to === failing.to
            ? new FakeRpcError(-32603, "internal error")
            : undefined,
      },
      // Queries report the failure instead of restarting the backfill.
      { retryMs: 60_000 }
    );
    await ctx.index.startBackfill();
    const status = ctx.index.status();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("internal error");
    // Everything newer than the broken chunk is committed; nothing below it is.
    expect(status.coveredFrom).toBe((failing.to + 1n).toString());
    expect(status.logs).toBe(inRange(history(), failing.to + 1n, FINAL).length);
    // 1 try + 3 retries.
    const tries = (from: bigint, to: bigint, list: (readonly [bigint, bigint])[]) =>
      list.filter(([f, t]) => f === from && t === to).length;
    expect(tries(failing.from, failing.to, ctx.chain.ranges())).toBe(4);
    await expect(ctx.index.logs({ waitMs: 1_000 })).rejects.toBeInstanceOf(IndexUnavailable);

    const before = ctx.chain.ranges().length;
    const answered = new Set(
      ctx.chain
        .ranges()
        .slice(1)
        .filter(([f, t]) => f !== failing.from || t !== failing.to)
        .map(([f, t]) => `${f}-${t}`)
    );
    broken = false;
    await ctx.index.startBackfill();
    const resumed = ctx.chain.ranges().slice(before);
    expect(resumed.map(([f, t]) => `${f}-${t}`)).toContain(`${failing.from}-${failing.to}`);
    for (const [f, t] of resumed) expect(answered.has(`${f}-${t}`)).toBe(false);
    expect(ctx.index.status()).toMatchObject({
      state: "ready",
      coveredFrom: DEPLOY.toString(),
      chunks: { done: 435, total: 435 },
    });
    expect(await ctx.index.logs()).toHaveLength(98);
  });

  it("is unavailable, with the RPC's message and no URL, when the RPC refuses history", async () => {
    const ctx = setup({
      override: () => new FakeRpcError(-32000, `archive requests need a paid plan (see ${URL_})`),
    });
    await ctx.index.startBackfill();
    const status = ctx.index.status();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("paid plan");
    expect(ctx.chain.ranges()).toHaveLength(1);
    const error = await ctx.index.logs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexUnavailable);
    expect(error).toBeInstanceOf(LogsUnavailableError);
    const text = `${(error as Error).message} ${status.error}`;
    expect(text).toContain("paid plan");
    expect(text).not.toContain("rpc.example.invalid");
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("waits for coverage up to the bound, then throws IndexIncomplete", async () => {
    const slowBelow = FINAL - 1_000_000n;
    const ctx = setup(
      { cap: 10_000n },
      {},
      {
        delayMs: (post) =>
          post.calls.some(
            (call) =>
              call.method === "eth_getLogs" &&
              BigInt((call.params[0] as { fromBlock: string }).fromBlock) < slowBelow &&
              BigInt((call.params[0] as { toBlock: string }).toBlock) < FINAL
          )
            ? 300
            : 0,
      }
    );
    const run = ctx.index.startBackfill();
    const error = await ctx.index.logs({ waitMs: 60 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexIncomplete);
    expect(error).toMatchObject({ needFrom: DEPLOY });
    // A recent range is already covered and answers.
    const recent = await ctx.index.logs({ fromBlock: FINAL - 100_000n });
    expect(recent.map((l) => l.blockNumber)).toEqual(
      inRange(history(), FINAL - 100_000n, FINAL).map((l) => l.blockNumber)
    );
    await run;
    expect(await ctx.index.logs({ waitMs: 0 })).toHaveLength(98);
  });

  it("re-sends a chunk once when it is slow; the first answer wins", async () => {
    let slow = true;
    const ctx = setup(
      { cap: 10_000n },
      { hedgeMs: 30 },
      {
        delayMs: (post) => {
          const first = post.calls.some(
            (call) =>
              call.method === "eth_getLogs" &&
              BigInt((call.params[0] as { toBlock: string }).toBlock) === FINAL - 100_000n
          );
          if (first && slow) {
            slow = false;
            return 800;
          }
          return 0;
        },
      }
    );
    const started = Date.now();
    await ctx.index.startBackfill();
    expect(Date.now() - started).toBeLessThan(700);
    expect(ctx.index.status()).toMatchObject({ state: "ready", logs: 98 });
    // The slow original answers later and changes nothing.
    await new Promise((r) => setTimeout(r, 850));
    const sent = ctx.chain.ranges().filter(([, to]) => to === FINAL - 100_000n);
    expect(sent).toHaveLength(2);
    expect(ctx.index.status()).toMatchObject({ state: "ready", logs: 98 });
    expect(await ctx.index.logs()).toHaveLength(98);
  });

  it("does not send everything twice when the provider is slow for everyone", async () => {
    // Every POST takes twice the hedge delay: no chunk is slow compared with the others.
    const ctx = setup({ cap: 10_000n }, { hedgeMs: 30 }, { delayMs: 60 });
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "ready", logs: 98 });
    // The full-range attempt and 435 chunks, and few re-sent (before: 836 requests, nearly every
    // chunk twice).
    expect(ctx.chain.ranges().length).toBeLessThanOrEqual(436 + 50);
  });
});

describe("range limits", () => {
  const sent = (ctx: ReturnType<typeof setup>) => ctx.chain.ranges().length;

  it("stops halving at 1,000 blocks: a 10-block limit is unavailable, not 500,000 requests", async () => {
    const message =
      "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.";
    const ctx = setup({
      override: ({ from, to }) =>
        to - from + 1n > 10n ? new FakeRpcError(-32000, message) : undefined,
    });
    await ctx.index.startBackfill();
    const status = ctx.index.status();
    expect(status).toMatchObject({ state: "unavailable", span: null, error: message });
    // 4,340,646 halved down to 1,059, then the 1,000-block floor once: 14 requests.
    expect(sent(ctx)).toBeLessThanOrEqual(25);
    const sizes = ctx.chain.ranges().map(([from, to]) => to - from + 1n);
    expect(sizes.at(-1)).toBe(1_000n);
    expect(Math.min(...sizes.map(Number))).toBe(1_000);
    const error = await ctx.index.logs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexUnavailable);
    expect(error).toBeInstanceOf(LogsUnavailableError);
    expect((error as Error).message).toContain("Use an RPC that serves log history");
  });

  it("is unavailable at once when the named cap is below 1,000 blocks", async () => {
    const ctx = setup({ cap: 10n });
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "unavailable", span: null });
    expect(ctx.index.status().error).toContain("exceeds limit of 10");
    expect(sent(ctx)).toBe(1);
  });

  it("chunks at a named cap of 1,000 blocks", async () => {
    const ctx = setup({ cap: 1_000n });
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "ready", span: "1000", logs: 98 });
  });

  it("leaves the span and the 435 chunks alone after a passing range-like error on a tail read", async () => {
    let failed = false;
    const ctx = setup(
      {
        cap: 10_000n,
        override: ({ from, to }) => {
          // The first tail read, (F, head], times out once.
          if (failed || from !== FINAL + 1n || to !== HEAD) return undefined;
          failed = true;
          return new FakeRpcError(-32000, `query timeout exceeded (${URL_})`);
        },
      },
      {},
      { delayMs: 2 }
    );
    // The query and the backfill's full-range request go out together.
    const [query] = await Promise.allSettled([ctx.index.logs(), ctx.index.startBackfill()]);
    expect(failed).toBe(true);
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({
      state: "ready",
      span: "10000",
      chunks: { done: 435, total: 435 },
    });
    // 80 blocks is below the floor: the query that hit it fails with today's
    // LogsUnavailableError text, without the URL; the next one answers.
    expect(query.status).toBe("rejected");
    const error = (query as PromiseRejectedResult).reason as Error;
    expect(error).toBeInstanceOf(IndexUnavailable);
    expect(error.message).toContain("query timeout exceeded");
    expect(error.message).not.toContain("rpc.example.invalid");
    expect(error.message).not.toContain("0123456789abcdef0123456789abcdef");
    expect(await ctx.index.logs()).toHaveLength(98);
  });

  it("keeps the span through a burst of range-like errors, at a bounded cost", async () => {
    let opened = 0;
    const ctx = setup(
      {
        cap: 10_000n,
        override: ({ from, to }) => {
          if (to - from >= 10_000n) return undefined;
          // Every chunk answered during a 150 ms window fails.
          opened ||= Date.now();
          const elapsed = Date.now() - opened;
          return elapsed > 5 && elapsed < 155
            ? new FakeRpcError(-32000, "query timeout exceeded")
            : undefined;
        },
      },
      { retryDelayMs: 20 },
      { delayMs: 5 }
    );
    await ctx.index.startBackfill();
    expect(ctx.index.status().span).toBe("10000");
    // The burst is over; the next run resumes from the gaps if it outlasted the retries.
    while (Date.now() - opened < 200) await new Promise((r) => setTimeout(r, 10));
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "ready", span: "10000", logs: 98 });
    // Before: the burst halved the index-wide span to 9 blocks, 260,272 chunks. Now the chunks
    // in flight (25 x 8) are each tried at most 4 times, plus a few split at the burst's edges.
    expect(ctx.index.status().chunks.total).toBeLessThan(600);
    expect(sent(ctx) - 436).toBeLessThanOrEqual(200 * 4 + 200);
  });

  it("splits only a range that stays too dense, and keeps the index-wide span", async () => {
    const dense = { from: FINAL - 1_009_999n, to: FINAL - 1_000_000n };
    const ctx = setup({
      cap: 10_000n,
      override: ({ from, to }) =>
        from <= dense.to && to >= dense.from && to - from + 1n > 2_500n && to - from < 10_000n
          ? new FakeRpcError(-32005, "query returned more than 10000 results")
          : undefined,
    });
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({
      state: "ready",
      span: "10000",
      logs: 98,
      // 10,000 -> 2 x 5,000 -> 4 x 2,500.
      chunks: { done: 438, total: 438 },
    });
    const pieces = ctx.chain
      .ranges()
      .filter(([from, to]) => from >= dense.from && to <= dense.to && to - from + 1n === 2_500n);
    expect(pieces).toHaveLength(4);
    expect(await ctx.index.logs()).toHaveLength(98);
  });
});

describe("log validation", () => {
  const dup = (log: ChainLog, chain: { address: Address }) => {
    const raw = {
      address: chain.address.toLowerCase(),
      topics: log.topics,
      data: "0x",
      blockNumber: `0x${log.blockNumber.toString(16)}`,
      blockHash: blockHash(log.blockNumber),
      transactionHash: blockHash(log.blockNumber, 1),
      transactionIndex: "0x0",
      logIndex: `0x${log.logIndex.toString(16)}`,
      removed: false,
    };
    return [raw, { ...raw }];
  };

  it("rejects an answer with the same log twice and retries the chunk", async () => {
    const logs = history();
    const target = logs[50] as ChainLog;
    let answers = 0;
    const ctx = setup({
      logs,
      cap: 10_000n,
      override: ({ from, to }) => {
        if (to - from >= 10_000n) return undefined;
        if (target.blockNumber < from || target.blockNumber > to || answers++ > 0) return undefined;
        return dup(target, { address: ADDRESS });
      },
    });
    await ctx.index.startBackfill();
    expect(ctx.index.status()).toMatchObject({ state: "ready", logs: 98 });
    const indexed = await ctx.index.logs();
    expect(indexed.filter((l) => l.blockNumber === target.blockNumber)).toHaveLength(1);
  });

  it.each([
    ["the same log twice", (log: ChainLog) => dup(log, { address: ADDRESS })],
    [
      "a removed log",
      (log: ChainLog) => [{ ...(dup(log, { address: ADDRESS })[0] as object), removed: true }],
    ],
    [
      "a log from another address",
      (log: ChainLog) =>
        dup(log, { address: "0x0000000000000000000000000000000000000001" }).slice(1),
    ],
    [
      "a log outside the requested blocks",
      (log: ChainLog) =>
        dup({ ...log, blockNumber: log.blockNumber + 50_000n }, { address: ADDRESS }).slice(1),
    ],
  ])("never indexes %s", async (_name, answer) => {
    const logs = history();
    const target = logs[50] as ChainLog;
    const ctx = setup({
      logs,
      cap: 10_000n,
      override: ({ from, to }) =>
        target.blockNumber >= from && target.blockNumber <= to && to - from < 10_000n
          ? answer(target)
          : undefined,
    });
    await ctx.index.startBackfill();
    const status = ctx.index.status();
    expect(status.state).toBe("unavailable");
    expect(BigInt(status.coveredFrom as string)).toBeGreaterThan(target.blockNumber);
    expect(status.logs).toBe(inRange(logs, BigInt(status.coveredFrom as string), FINAL).length);
  });
});

describe("heads", () => {
  const H = HEAD;
  const at = (number: bigint, salt = 0): IndexHead => ({
    head: { number, hash: blockHash(number, salt) },
    safe: number - 80n,
  });

  it("replaces the tail per head: a reorged log disappears", async () => {
    const logs = history();
    const reorged: ChainLog = { blockNumber: H - 3n, logIndex: 0, topics: [blockHash(1n)] };
    logs.push(reorged);
    const ctx = setup({ logs });
    await ctx.index.startBackfill();
    let result = await ctx.index.logs();
    expect(result.map((l) => l.blockNumber)).toContain(H - 3n);
    expect(ctx.index.status().headTo).toBe(H.toString());

    // A new block on a different branch: the log is gone and another one appears.
    logs.splice(logs.indexOf(reorged), 1);
    logs.push({ blockNumber: H - 2n, logIndex: 0, topics: [blockHash(2n)] });
    ctx.head.current = { ...at(H + 1n, 1), safe: FINAL };
    result = await ctx.index.logs();
    expect(result.map((l) => l.blockNumber)).not.toContain(H - 3n);
    expect(result.map((l) => l.blockNumber)).toContain(H - 2n);
    expect(result).toHaveLength(99);
  });

  it("reads each head once and promotes a log to final exactly once, from a fresh read", async () => {
    const logs = history();
    logs.push({ blockNumber: FINAL + 10n, logIndex: 0, topics: [blockHash(3n)] });
    logs.push({ blockNumber: FINAL + 30n, logIndex: 0, topics: [blockHash(4n)] });
    const ctx = setup({ logs });
    await ctx.index.startBackfill();
    await Promise.all([ctx.index.logs(), ctx.index.logs(), ctx.index.logs()]);
    // One tail read for the head, shared by concurrent queries.
    expect(ctx.chain.ranges().slice(1)).toEqual([[FINAL + 1n, H]]);

    // F moves past the first log: it is promoted from this head's read.
    ctx.head.current = { head: { number: H + 20n, hash: blockHash(H + 20n) }, safe: FINAL + 20n };
    let result = await ctx.index.logs();
    expect(ctx.chain.ranges().at(-1)).toEqual([FINAL + 1n, H + 20n]);
    expect(ctx.index.status()).toMatchObject({ finalizedTo: (FINAL + 20n).toString() });
    expect(result.filter((l) => l.blockNumber === FINAL + 10n)).toHaveLength(1);

    // The next head starts above the new boundary and never re-reads the promoted log.
    ctx.head.current = { head: { number: H + 40n, hash: blockHash(H + 40n) }, safe: FINAL + 40n };
    result = await ctx.index.logs();
    expect(ctx.chain.ranges().at(-1)).toEqual([FINAL + 21n, H + 40n]);
    expect(result.filter((l) => l.blockNumber === FINAL + 10n)).toHaveLength(1);
    expect(result.filter((l) => l.blockNumber === FINAL + 30n)).toHaveLength(1);
    expect(result).toHaveLength(100);
  });

  it("never promotes a log from an older tail", async () => {
    const logs = history();
    const orphan: ChainLog = { blockNumber: FINAL + 10n, logIndex: 0, topics: [blockHash(5n)] };
    logs.push(orphan);
    const ctx = setup({ logs });
    await ctx.index.startBackfill();
    expect((await ctx.index.logs()).map((l) => l.blockNumber)).toContain(FINAL + 10n);
    // Reorged out before it became final.
    logs.splice(logs.indexOf(orphan), 1);
    ctx.head.current = { head: { number: H + 20n, hash: blockHash(H + 20n) }, safe: FINAL + 20n };
    expect((await ctx.index.logs()).map((l) => l.blockNumber)).not.toContain(FINAL + 10n);
    ctx.head.current = { head: { number: H + 40n, hash: blockHash(H + 40n) }, safe: FINAL + 40n };
    expect((await ctx.index.logs()).map((l) => l.blockNumber)).not.toContain(FINAL + 10n);
  });

  it("answers a query from the tail read at its own head, never from an older head's", async () => {
    const logs = history();
    // A log in the newest block.
    logs.push({ blockNumber: H, logIndex: 0, topics: [blockHash(9n)] });
    const ctx = setup(
      { logs },
      {},
      {
        // The full-range backfill is slow; tail reads are fast.
        delayMs: (post) =>
          post.calls.some(
            (call) =>
              call.method === "eth_getLogs" &&
              BigInt((call.params[0] as { fromBlock: string }).fromBlock) === DEPLOY
          )
            ? 300
            : 0,
      }
    );
    const run = ctx.index.startBackfill();
    await new Promise((r) => setTimeout(r, 20));
    // Q1 sees head H, reads its tail, and waits for the backfill.
    const q1 = ctx.index.logs();
    await new Promise((r) => setTimeout(r, 50));
    // The next head read (another backend behind a load balancer) is one block behind.
    ctx.head.current = { head: { number: H - 1n, hash: blockHash(H - 1n) }, safe: FINAL };
    const q2 = await ctx.index.logs({ fromBlock: FINAL + 1n });
    expect(q2.map((l) => l.blockNumber)).not.toContain(H);
    expect(ctx.index.status().headTo).toBe((H - 1n).toString());
    const r1 = await q1;
    await run;
    expect(r1.map((l) => l.blockNumber)).toContain(H);
    expect(r1).toHaveLength(99);
  });

  it("fails a query whose tail read fails with IndexUnavailable, without waiting out the bound", async () => {
    const ctx = setup({
      override: ({ from }) =>
        from === FINAL + 1n ? new FakeRpcError(-32603, `internal error at ${URL_}`) : undefined,
    });
    await ctx.index.startBackfill();
    const started = Date.now();
    const error = await ctx.index.logs({ waitMs: 60_000 }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toBeInstanceOf(IndexUnavailable);
    expect(error).toBeInstanceOf(LogsUnavailableError);
    expect(error).toMatchObject({ fromBlock: FINAL + 1n, toBlock: H });
    expect((error as Error).message).toContain("internal error");
    expect((error as Error).message).not.toContain("rpc.example.invalid");
    // The backfill itself is unaffected.
    expect(ctx.index.status().state).toBe("ready");
  });

  it("answers a range at or below the boundary without a tail read", async () => {
    const ctx = setup({});
    await ctx.index.startBackfill();
    const logs = await ctx.index.logs({ fromBlock: DEPLOY, toBlock: DEPLOY });
    expect(logs.map((l) => l.blockNumber)).toEqual([DEPLOY]);
    expect(ctx.chain.ranges()).toHaveLength(1);
  });
});

describe("settings changes", () => {
  it("never inserts results that arrive after the settings changed", async () => {
    let current = true;
    const ctx = setup({}, { isCurrent: () => current }, { delayMs: 200 });
    const run = ctx.index.startBackfill();
    await new Promise((r) => setTimeout(r, 10));
    current = false;
    await run;
    expect(ctx.chain.ranges()).toHaveLength(1);
    expect(ctx.index.status()).toMatchObject({ coveredFrom: null, logs: 0 });
    await expect(ctx.index.logs()).rejects.toBeInstanceOf(IndexClosed);
  });

  it("discards everything on close, including a query in flight", async () => {
    const ctx = setup({});
    await ctx.index.startBackfill();
    const query = ctx.index.logs();
    ctx.index.close();
    await expect(query).rejects.toBeInstanceOf(IndexClosed);
    expect(ctx.index.status().logs).toBe(0);
  });
});
