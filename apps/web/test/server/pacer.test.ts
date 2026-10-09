import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { governance, readGovernance } from "@/.server/governance";
import { refreshHead, resetRpcClients } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { verifySignatureSet, watchSignatureSet } from "@/.server/signatures";
import { stopSync } from "@/.server/sync/engine";
import {
  CreditPacer,
  asEngineWork,
  creditsOf,
  isEngineWork,
  pacer,
  readRateFrom,
  resetPacer,
} from "@/.server/sync/pacer";
import { presence, resetPresence } from "@/.server/sync/presence";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PINS } from "../support/fake-l1";
import {
  NOW,
  SLOT_MS,
  backfilled,
  liveEngine,
  liveWorld,
  settle,
  until,
} from "../support/live-world";

// C-6: the sync engine's own upstream work keeps to SYNC_CREDITS_PER_SECOND (Infura credit
// weights: eth_getLogs 255, eth_chainId 5, everything else 80) in any one second, in steady state
// and in recompute bursts; a request's own reads never wait for it.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetPacer();
});

afterEach(() => {
  resetPacer();
  readRateFrom(() => 0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The most credits sent in any one-second window of `sent` (time, credits). */
function peakPerSecond(sent: { at: number; credits: number }[]): number {
  let peak = 0;
  for (const start of sent) {
    let sum = 0;
    for (const entry of sent)
      if (entry.at >= start.at && entry.at < start.at + 1_000) sum += entry.credits;
    peak = Math.max(peak, sum);
  }
  return peak;
}

describe("the credit pacer", () => {
  it("weighs requests as Infura bills them", () => {
    expect(creditsOf("eth_getLogs")).toBe(255);
    expect(creditsOf("eth_chainId")).toBe(5);
    expect(creditsOf("eth_call")).toBe(80);
    expect(creditsOf("eth_getBlockByNumber")).toBe(80);
  });

  it("a burst goes out within the rate in any one second, in order", async () => {
    const pace = new CreditPacer(450);
    const sent: { at: number; credits: number; i: number }[] = [];
    const burst = [255, 80, 80, 80, 255, 80, 80, 80, 80, 255, 80, 80];
    const all = burst.map((credits, i) => {
      const wait = pace.take(credits);
      const done = () => sent.push({ at: Date.now(), credits, i });
      if (wait) return wait.then(done);
      done();
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(all);
    expect(sent.map((s) => s.i)).toEqual(burst.map((_, i) => i));
    expect(peakPerSecond(sent)).toBeLessThanOrEqual(450);
    // It took about as long as the rate allows (1,505 credits at 450 a second).
    expect((sent.at(-1)?.at ?? 0) - NOW).toBeGreaterThanOrEqual(3_000);
    expect(pace.status()).toMatchObject({ creditsPerSecond: 450, queued: 0 });
    expect(pace.status().peakPerSecond).toBeLessThanOrEqual(450);
  });

  it("a block's work in steady state (a poll, the tail, the aggregate, polls a second apart) never waits", async () => {
    const pace = new CreditPacer(450);
    for (let block = 0; block < 50; block++) {
      for (const credits of [80, 255, 80]) expect(pace.take(credits)).toBeNull();
      for (let poll = 0; poll < 2; poll++) {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(pace.take(80)).toBeNull();
      }
      await vi.advanceTimersByTimeAsync(SLOT_MS - 2_000);
    }
    expect(pace.status()).toMatchObject({ waited: 0, queued: 0 });
  });

  it("one request above the whole rate goes alone in an empty second; 0 is unpaced", async () => {
    const pace = new CreditPacer(200);
    expect(pace.take(255)).toBeNull();
    const next = pace.take(80);
    expect(next).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await next;
    const unpaced = new CreditPacer(0);
    for (let i = 0; i < 100; i++) expect(unpaced.take(255)).toBeNull();
  });

  it("tells the engine's own work from a request's, through its asynchronous continuations", async () => {
    expect(isEngineWork()).toBe(false);
    const inside = asEngineWork(async () => {
      await Promise.resolve();
      const before = isEngineWork();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [before, isEngineWork()];
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await inside).toEqual([true, true]);
    expect(isEngineWork()).toBe(false);
  });
});

describe("C-6: the live engine at its pace", () => {
  beforeEach(() => {
    clearCache();
    resetRpcClients();
    resetSafeClient();
    resetPresence({ keepWarmMs: 600_000 });
    resetVerdicts();
    overrideCodePinsForTests(FAKE_PINS);
  });

  afterEach(() => {
    stopSync();
    overrideCodePinsForTests(undefined);
    resetPresence();
  });

  /** Every POST's JSON-RPC entries with their credits, as the fake node received them. */
  const creditsSent = (w: ReturnType<typeof liveWorld>, from: number) =>
    w.fake.posts
      .slice(from)
      .flatMap((p) => p.calls.map((c) => ({ at: p.startedAt, credits: creditsOf(c.method) })));

  it("keeps the engine's credits a second at most SYNC_CREDITS_PER_SECOND, its first burst included; a request's own reads go at once, and one that waits on the engine's work hurries it", async () => {
    readRateFrom(() => 0);
    const w = liveWorld();
    await backfilled();
    await settle(governance());
    for (const set of w.sets) await settle(verifySignatureSet(set));
    presence().beat({
      tab: "tab-under-test",
      reason: "interval",
      items: w.sets.map((set) => watchSignatureSet(set)),
    });
    // A slow pace: the engine's first tick (the tail, the snapshot, every set's verdicts) waits.
    readRateFrom(() => 100);
    const engine = liveEngine({
      pacePoll: (withFinalized) =>
        pacer().take(creditsOf("eth_getBlockByNumber") * (withFinalized ? 2 : 1)),
    });
    // A new head: the engine's first tick verifies every set there.
    w.nextBlock();
    const from = w.fake.posts.length;
    engine.resume();
    await until(() => pacer().status().queued > 0, 10_000);
    // A request's own reads (a full governance read, rounds of them) go out at once.
    let before = Date.now();
    await settle(readGovernance());
    expect(Date.now() - before).toBeLessThan(200);
    expect(pacer().status().queued).toBeGreaterThan(0);
    // A request that waits on the engine's work (the set it is verifying at the new head, which
    // the request reads itself): the engine's waiting reads go at once.
    refreshHead();
    before = Date.now();
    const answered = await settle(verifySignatureSet(w.sets[1] as (typeof w.sets)[number]));
    expect(answered.thresholdCheck.status).toBe("met");
    expect(Date.now() - before).toBeLessThan(500);
    const hurriedAt = Date.now();
    await until(() => engine.status().ticks >= 1, 30_000);
    for (let i = 0; i < 5; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
    }
    const status = pacer().status();
    expect(status.waited).toBeGreaterThan(0);
    expect(status.expedited).toBeGreaterThan(0);
    // Outside the moments a request hurried it, the engine kept its pace at the node too (one
    // request above the pace may go alone, and a POST leaves a few ms after its turn).
    const sent = creditsSent(w, from).filter((s) => s.at > hurriedAt + 1_000);
    expect(peakPerSecond(sent)).toBeLessThanOrEqual(100 + 255);
  });
});
