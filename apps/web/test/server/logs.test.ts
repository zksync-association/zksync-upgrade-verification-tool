import {
  LogsUnavailableError,
  findBlockByTimestamp,
  getLogs,
  merge,
  resetLogCaches,
  seedLogSpan,
} from "@/.server/logs";
import { l1, lanes, resetRpcClients } from "@/.server/rpc";
import { type PublicClient, numberToHex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeChain, spreadLogs } from "../support/fake-chain";
import { fakeJsonRpc } from "../support/fake-jsonrpc";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const TOPIC = `0x${"aa".repeat(32)}` as const;

/** A fake RPC with logs at the given blocks and a maximum eth_getLogs range. */
function fakeLogsClient({ logBlocks, maxRange }: { logBlocks: bigint[]; maxRange: bigint | null }) {
  const calls: [bigint, bigint][] = [];
  const client = {
    request: async ({
      method,
      params,
    }: { method: string; params: [{ fromBlock: string; toBlock: string }] }) => {
      if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
      const from = BigInt(params[0].fromBlock);
      const to = BigInt(params[0].toBlock);
      calls.push([from, to]);
      if (maxRange === null) throw new Error("Archive requests require a personal token");
      if (to - from + 1n > maxRange) throw new Error("query exceeds max block range");
      return logBlocks
        .filter((b) => b >= from && b <= to)
        .map((b) => ({
          address: ADDRESS,
          topics: [TOPIC],
          data: "0x",
          blockNumber: numberToHex(b),
          blockHash: `0x${"00".repeat(32)}`,
          transactionHash: `0x${b.toString(16).padStart(64, "0")}`,
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
        }));
    },
  } as unknown as PublicClient;
  return { client, calls };
}

describe("getLogs", () => {
  it("uses the provider's explicit block cap instead of repeatedly halving the range", async () => {
    const spans: bigint[] = [];
    const client = {
      request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
        const span = BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) + 1n;
        spans.push(span);
        if (span > 10_000n) throw new Error(`range ${span} exceeds limit of 10000`);
        return [];
      },
    } as unknown as PublicClient;
    await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 99_999n, { safeHead: -1n });
    expect(spans).toEqual([100_000n, ...Array(10).fill(10_000n)]);
  });
  it("does not shrink ranges or fan out when the RPC times out", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockResolvedValue([]);
    const client = { request } as unknown as PublicClient;
    await expect(
      getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 100_000n, { safeHead: -1n })
    ).rejects.toBeInstanceOf(LogsUnavailableError);
    expect(request).toHaveBeenCalledTimes(1);
    await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 100_000n, { safeHead: -1n });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].params[0].toBlock).toBe(numberToHex(100_000n));
  });

  it("keeps history chunks bounded and allows a small event lookup while history is pending", async () => {
    const pending: (() => void)[] = [];
    const client = {
      request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
        const from = BigInt(params[0].fromBlock);
        const to = BigInt(params[0].toBlock);
        if (to - from + 1n > 1_000n) throw new Error("range 4001 exceeds limit of 1000");
        if (from > 0n && to - from > 10n)
          return new Promise<[]>((resolve) => {
            pending.push(() => resolve([]));
          });
        return [];
      },
    } as unknown as PublicClient;
    const history = getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 4_000n, {
      safeHead: -1n,
    });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(
      await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 5n, 6n, { safeHead: -1n })
    ).toEqual([]);
    for (let i = 0; i < 3; i++) {
      if (!pending[i]) await vi.waitFor(() => expect(pending[i]).toBeDefined());
      pending[i]?.();
    }
    await history;
  });
  it("evicts a failed shared recent scan so the next request can retry", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const client = { request } as unknown as PublicClient;
    const scan = () =>
      getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 10n, { safeHead: -1n });
    const results = await Promise.allSettled([scan(), scan()]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await scan()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("shares concurrent recent-range scans but re-reads after completion, including on forks", async () => {
    let complete!: (logs: []) => void;
    const request = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          complete = resolve;
        })
    );
    const client = { request } as unknown as PublicClient;
    const scan = () =>
      getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 10n, { safeHead: -1n });
    const first = scan();
    const second = scan();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(request).toHaveBeenCalledTimes(1);
    complete([]);
    await Promise.all([first, second]);
    const third = scan();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    complete([]);
    await third;
  });
  it("splits ranges the RPC refuses, learns its limit and returns every log once", async () => {
    const { client, calls } = fakeLogsClient({
      logBlocks: [100n, 50_000n, 99_999n],
      maxRange: 10_000n,
    });
    const logs = await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 100_000n, {
      safeHead: 100_000n,
    });
    expect(logs.map((l) => l.blockNumber)).toEqual([100n, 50_000n, 99_999n]);
    // After learning the limit, no request asks for more than it.
    const later = calls.slice(calls.findIndex(([f, t]) => t - f + 1n <= 10_000n));
    expect(later.every(([f, t]) => t - f + 1n <= 10_000n)).toBe(true);
    // Failures stay sequential: 100k → 50k → 25k → 12.5k → 6.25k, then 16 chunks.
    expect(calls.filter(([f, t]) => t - f + 1n > 10_000n)).toHaveLength(4);
    expect(calls.length).toBeLessThanOrEqual(4 + 17);
  });

  it("caches finalized ranges and reads the newest gap and the tail as one range", async () => {
    const { client, calls } = fakeLogsClient({
      logBlocks: [10n, 900n, 1_150n],
      maxRange: 1_000_000n,
    });
    const filter: Parameters<typeof getLogs>[1] = { address: ADDRESS, topics: [TOPIC] };
    expect(
      (await getLogs(client, filter, 0n, 1_000n, { safeHead: 800n })).map((l) => l.blockNumber)
    ).toEqual([10n, 900n]);
    expect(calls).toEqual([[0n, 1_000n]]);
    calls.length = 0;
    const logs = await getLogs(client, filter, 0n, 1_200n, { safeHead: 1_100n });
    expect(calls).toEqual([[801n, 1_200n]]);
    expect(logs.map((l) => l.blockNumber)).toEqual([10n, 900n, 1_150n]);
    // Only the finalized part was kept: the tail above 1,100 is read again.
    calls.length = 0;
    expect(
      (await getLogs(client, filter, 0n, 1_200n, { safeHead: 1_100n })).map((l) => l.blockNumber)
    ).toEqual([10n, 900n, 1_150n]);
    expect(calls).toEqual([[1_101n, 1_200n]]);
  });

  it("keeps an older gap apart from the tail", async () => {
    const { client, calls } = fakeLogsClient({ logBlocks: [50n, 650n], maxRange: 1_000_000n });
    const filter: Parameters<typeof getLogs>[1] = { address: ADDRESS, topics: [TOPIC] };
    await getLogs(client, filter, 100n, 600n, { safeHead: 600n });
    calls.length = 0;
    const logs = await getLogs(client, filter, 0n, 700n, { safeHead: 600n });
    // [0, 99] is a gap below cached [100, 600]; the tail (600, 700] is not adjacent to it.
    expect(calls).toEqual([
      [0n, 99n],
      [601n, 700n],
    ]);
    expect(logs.map((l) => l.blockNumber)).toEqual([50n, 650n]);
  });

  it("does not cache anything on dev nodes (safe head -1)", async () => {
    const { client, calls } = fakeLogsClient({ logBlocks: [5n], maxRange: 1_000_000n });
    await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 10n, { safeHead: -1n });
    await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 10n, { safeHead: -1n });
    expect(calls).toEqual([
      [0n, 10n],
      [0n, 10n],
    ]);
  });

  it("gives up with the RPC's own message when it refuses logs outright", async () => {
    const { client } = fakeLogsClient({ logBlocks: [], maxRange: null });
    const promise = getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 50_000n, {
      safeHead: -1n,
    });
    await expect(promise).rejects.toBeInstanceOf(LogsUnavailableError);
    await expect(promise).rejects.toThrow(/Archive requests require a personal token/);
  });

  it("merges adjacent and overlapping segments", () => {
    expect(
      merge([
        { from: 10n, to: 20n },
        { from: 0n, to: 9n },
        { from: 15n, to: 30n },
        { from: 40n, to: 50n },
      ])
    ).toEqual([
      { from: 0n, to: 30n },
      { from: 40n, to: 50n },
    ]);
  });
});

describe("getLogs on the app's L1 client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function upstream() {
    resetRpcClients();
    resetLogCaches();
    // Infura-like: to − from above 10,000 is refused with the cap named.
    const chain = fakeChain({ address: ADDRESS, logs: spreadLogs(5, 0n, 99_999n), cap: 10_000n });
    const fake = fakeJsonRpc({ handle: (call) => chain.handle(call) });
    vi.stubGlobal("fetch", fake.fetch);
    return { chain, fake };
  }

  it("sends chunks through the history lane, batched, after one probe", async () => {
    const { chain, fake } = upstream();
    const logs = await getLogs(l1, { address: ADDRESS, topics: [] }, 0n, 99_999n, {
      safeHead: -1n,
    });
    expect(logs).toHaveLength(5);
    // The refused probe, the first chunk alone, then the other nine in one POST.
    expect(chain.ranges()).toHaveLength(11);
    expect(fake.sizes()).toEqual([1, 1, 9]);
    expect(lanes().history.stats().requests).toBe(11);
  });

  it("starts at a cap the log index already learned on the same lane", async () => {
    const { chain, fake } = upstream();
    seedLogSpan(lanes().history, 10_000n);
    await getLogs(l1, { address: ADDRESS, topics: [] }, 0n, 99_999n, { safeHead: -1n });
    expect(chain.ranges().every(([from, to]) => to - from + 1n <= 10_000n)).toBe(true);
    expect(fake.sizes()).toEqual([1, 9]);
  });
});

describe("findBlockByTimestamp", () => {
  function chain(timestamps: bigint[]) {
    let headers = 0;
    const client = {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        headers++;
        return { timestamp: timestamps[Number(blockNumber)] as bigint };
      },
    } as unknown as PublicClient;
    return { client, headers: () => headers };
  }

  it("finds the first block at or after a time with a handful of headers on a regular chain", async () => {
    // 12 s slots with a few missed ones, like mainnet.
    const ts: bigint[] = [];
    let t = 1_000_000n;
    for (let i = 0; i < 2_000_000; i++) {
      ts.push(t);
      t += i % 97 === 0 ? 24n : 12n;
    }
    const { client, headers } = chain(ts);
    const target = ts[1_234_567] as bigint;
    expect(await findBlockByTimestamp(client, target, 0n, BigInt(ts.length - 1), null)).toBe(
      1_234_567n
    );
    expect(headers()).toBeLessThan(12);
  });

  it("returns the first of several blocks sharing a timestamp (dev chains)", async () => {
    const { client } = chain([1n, 2n, 5n, 5n, 5n, 9n]);
    expect(await findBlockByTimestamp(client, 5n, 0n, 5n, null)).toBe(2n);
    expect(await findBlockByTimestamp(client, 6n, 0n, 5n, null)).toBe(5n);
    expect(await findBlockByTimestamp(client, 0n, 0n, 5n, null)).toBe(0n);
  });
});
