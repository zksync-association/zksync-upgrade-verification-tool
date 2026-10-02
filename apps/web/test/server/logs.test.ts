import { LogsUnavailableError, findBlockByTimestamp, getLogs, merge } from "@/.server/logs";
import { type PublicClient, numberToHex } from "viem";
import { describe, expect, it } from "vitest";

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

  it("caches finalized ranges and only fetches the new tail afterwards", async () => {
    const { client, calls } = fakeLogsClient({ logBlocks: [10n, 900n], maxRange: 1_000_000n });
    await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 1_000n, { safeHead: 800n });
    expect(calls).toEqual([
      [0n, 800n],
      [801n, 1_000n],
    ]);
    calls.length = 0;
    const logs = await getLogs(client, { address: ADDRESS, topics: [TOPIC] }, 0n, 1_200n, {
      safeHead: 1_100n,
    });
    expect(calls).toEqual([
      [801n, 1_100n],
      [1_101n, 1_200n],
    ]);
    expect(logs.map((l) => l.blockNumber)).toEqual([10n, 900n]);
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
