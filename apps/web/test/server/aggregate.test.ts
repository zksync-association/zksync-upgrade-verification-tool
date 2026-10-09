import { clearCache } from "@/.server/cache";
import {
  AggregateDropped,
  AggregateFailed,
  AnsweredOtherBlock,
  LEARN_GUARD_AFTER,
  MAX_VERDICTS,
  aggregateAllAt,
  aggregateAt,
  aggregateStatus,
  resetAggregateStatus,
} from "@/.server/chain/aggregate";
import { latestBlock, resetRpcClients } from "@/.server/rpc";
import { asEngineWork, pacer, readRateFrom, resetPacer } from "@/.server/sync/pacer";
import { guardiansAbi, upgradeHandlerAbi } from "@/common/abis";
import { encodeFunctionData, numberToHex, zeroHash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockHash } from "../support/fake-chain";
import { FakeRpcError } from "../support/fake-jsonrpc";
import { type FakeL1Options, G_MEMBERS, L1, fakeL1 } from "../support/fake-l1";
import { HEAD, HEAD_TIME, NOW, settle } from "../support/live-world";

// chain/aggregate.ts: reads at one head gathered into Multicall3 aggregate3 calls, pinned to the
// head's number, each carrying the block guard (getBlockNumber, getLastBlockHash).

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetAggregateStatus();
  resetPacer();
});

afterEach(() => {
  readRateFrom(() => 0);
  resetPacer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function node(options: Omit<FakeL1Options, "head"> = {}) {
  const fake = fakeL1({ head: { number: HEAD, timestamp: HEAD_TIME }, ...options });
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

const nonce = {
  target: L1.guardians,
  callData: encodeFunctionData({ abi: guardiansAbi, functionName: "nonce" }),
};
const check = (i: number) => ({
  target: L1.guardians,
  kind: "verdict" as const,
  callData: encodeFunctionData({
    abi: guardiansAbi,
    functionName: "checkSignatures",
    args: [zeroHash, [G_MEMBERS[0] as `0x${string}`], [numberToHex(i, { size: 65 })], 1n],
  }),
});
const state = (id: number) => ({
  target: L1.upgradeHandler,
  callData: encodeFunctionData({
    abi: upgradeHandlerAbi,
    functionName: "upgradeState",
    args: [numberToHex(id, { size: 32 })],
  }),
});

describe("aggregates at a head", () => {
  it("whatever is asked within a few ms goes out as one aggregate3 at the head's number, the guard first", async () => {
    const fake = node();
    const head = await settle(latestBlock());
    const results = await settle(aggregateAllAt(head, [nonce, state(1), state(2), check(1)]));
    expect(results).toHaveLength(4);
    expect(results[0]?.success).toBe(true);
    // The checkSignatures of an unknown signer: the contract's revert, as (false, data).
    expect(results[3]?.success).toBe(false);
    expect(fake.aggregates).toHaveLength(1);
    expect(fake.aggregates[0]).toEqual({
      block: numberToHex(HEAD),
      functions: [
        "getBlockNumber",
        "getLastBlockHash",
        "nonce",
        "upgradeState",
        "upgradeState",
        "checkSignatures",
      ],
    });
    expect(aggregateStatus()).toMatchObject({
      aggregates: 1,
      subCalls: 4,
      failures: 0,
      guard: { conventions: { block: 1, "next-block": 0 }, failures: 0 },
    });
  });

  it(`at most ${MAX_VERDICTS} verdicts per aggregate3: more go in another`, async () => {
    const fake = node();
    const head = await settle(latestBlock());
    const calls = [
      ...Array.from({ length: 70 }, (_, i) => check(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => state(i + 1)),
    ];
    await settle(aggregateAllAt(head, calls));
    expect(fake.aggregates).toHaveLength(2);
    const verdicts = fake.aggregates.map(
      (a) => a.functions.filter((f) => f === "checkSignatures").length
    );
    expect(verdicts).toEqual([MAX_VERDICTS, 70 - MAX_VERDICTS]);
  });

  it("a whole-call failure (out of gas, an RPC error) answers nothing in it", async () => {
    node({ aggregateError: () => new FakeRpcError(-32000, "out of gas") });
    const head = await settle(latestBlock());
    const out = aggregateAllAt(head, [nonce, check(1)]);
    await expect(settle(out)).rejects.toBeInstanceOf(AggregateFailed);
    expect(aggregateStatus().failures).toBe(1);
  });

  it("an answer from another block (neither the block's context nor the next one's) answers nothing", async () => {
    node({
      guardAt: (block) =>
        block === numberToHex(HEAD)
          ? { number: HEAD - 1n, lastHash: blockHash(HEAD - 2n) }
          : undefined,
    });
    const head = await settle(latestBlock());
    const out = aggregateAt(head, nonce);
    await expect(settle(out)).rejects.toBeInstanceOf(AnsweredOtherBlock);
    expect(aggregateStatus().guard).toMatchObject({
      failures: 1,
      lastFailure: { block: HEAD.toString(), answered: (HEAD - 1n).toString() },
    });
  });

  it(`once the provider answered ${LEARN_GUARD_AFTER} aggregates in the block's own context (none in the next's), an answer in the next block's context is from another block`, async () => {
    let nextContext = false;
    node({
      guardAt: (block) =>
        nextContext
          ? { number: BigInt(block) + 1n, lastHash: blockHash(BigInt(block)) }
          : undefined,
    });
    const head = await settle(latestBlock());
    for (let i = 0; i < LEARN_GUARD_AFTER; i++) await settle(aggregateAt(head, nonce));
    expect(aggregateStatus().guard).toMatchObject({ learned: "block", failures: 0 });
    // (M+1, hash of M): what a backend of this provider answers when it runs block M+1.
    nextContext = true;
    await expect(settle(aggregateAt(head, nonce))).rejects.toBeInstanceOf(AnsweredOtherBlock);
    expect(aggregateStatus().guard).toMatchObject({ learned: "block", failures: 1 });
    // Another data source learns afresh.
    resetRpcClients();
    expect(aggregateStatus().guard.learned).toBeNull();
    await settle(aggregateAt(await settle(latestBlock()), nonce));
    expect(aggregateStatus().guard.conventions["next-block"]).toBe(1);
  });

  it("a provider that answered in both conventions early keeps both", async () => {
    // Asked twice per aggregate (its number and its hash): every ninth aggregate in the next
    // block's context, the first one included.
    let asked = 0;
    node({
      guardAt: (block) =>
        Math.floor(asked++ / 2) % 9 === 0
          ? { number: BigInt(block) + 1n, lastHash: blockHash(BigInt(block)) }
          : undefined,
    });
    const head = await settle(latestBlock());
    for (let i = 0; i < 2 * LEARN_GUARD_AFTER + 2; i++) await settle(aggregateAt(head, nonce));
    expect(aggregateStatus().guard).toMatchObject({ learned: null, failures: 0 });
  });

  it("an answer that arrives after the settings changed is dropped", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    node({ gate: (call) => (call.functionName === "nonce" ? held : undefined) });
    const head = await settle(latestBlock());
    const out = aggregateAt(head, nonce);
    void out.catch(() => {});
    await vi.advanceTimersByTimeAsync(50);
    resetRpcClients();
    release();
    await expect(settle(out)).rejects.toThrow(/settings changed/);
    // Not a failure of the provider (the verdict breaker does not count it, chain/verdicts.ts).
    await expect(out).rejects.toBeInstanceOf(AggregateDropped);
  });

  it("the engine's own aggregate keeps its pace; one a request added to goes at once", async () => {
    const fake = node();
    const head = await settle(latestBlock());
    readRateFrom(() => 100);
    // The pace is spent: the next engine request waits about a second.
    pacer().take(100);
    const engineOnly = asEngineWork(() => aggregateAt(head, nonce));
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.aggregates).toHaveLength(0);
    expect(pacer().status().queued).toBe(1);
    await settle(engineOnly);
    expect(fake.aggregates).toHaveLength(1);
    // A request's sub-call in the same window as the engine's: the aggregate goes now.
    pacer().take(100);
    const mixed = Promise.all([
      asEngineWork(() => aggregateAt(head, state(1))),
      aggregateAt(head, state(2)),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.aggregates).toHaveLength(2);
    await settle(mixed);
  });
});
