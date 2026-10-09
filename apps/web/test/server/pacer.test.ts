import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { governance, readGovernance } from "@/.server/governance";
import { refreshHead, resetRpcClients } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { verifySignatureSet, watchSignatureSet } from "@/.server/signatures";
import { stopSync } from "@/.server/sync/engine";
import { limitedHttp } from "@/.server/rpc-transport";
import {
  CreditPacer,
  EngineWorkDropped,
  allowEngineWorkWhen,
  asEngineWork,
  creditsOf,
  isEngineWork,
  paceAsEngine,
  paceEngineRequest,
  pacer,
  readRateFrom,
  resetPacer,
} from "@/.server/sync/pacer";
import { presence, resetPresence } from "@/.server/sync/presence";
import { createPublicClient } from "viem";
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

// SYNC_VERDICT_AGGREGATE=0 for the tests that ask for it (the env is read once per process).
const flags = vi.hoisted(() => ({ aggregateOff: false }));
vi.mock("@config/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@config/env.server")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, name) =>
        name === "SYNC_VERDICT_AGGREGATE" && flags.aggregateOff ? 0 : Reflect.get(target, name),
    }),
  };
});

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

describe("R-D3: the engine's work goes out only while the engine may send", () => {
  // The engine's rule, put back after a test that replaced it (even one that timed out).
  let previous: ReturnType<typeof allowEngineWorkWhen> | null = null;
  afterEach(() => {
    if (previous) allowEngineWorkWhen(previous);
    previous = null;
  });

  /** A rule the test moves: whether the engine may send, and the settings generation. */
  const rule = () => {
    const state = { allowed: true, generation: 1 };
    return {
      state,
      rule: { allowed: () => state.allowed, generation: () => state.generation },
    };
  };

  it("a waiter whose turn comes once the engine may no longer send is dropped, never released", async () => {
    const { state, rule: sendRule } = rule();
    const pace = new CreditPacer(160, Date.now, () => sendRule);
    expect(pace.take(160)).toBeNull();
    const released: number[] = [];
    const outcomes = [80, 80].map((credits, i) => {
      const wait = pace.take(credits);
      expect(wait).not.toBeNull();
      return (wait as Promise<void>).then(
        () => released.push(i),
        (error: unknown) => error
      );
    });
    expect(pace.status().queued).toBe(2);
    state.allowed = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(released).toEqual([]);
    for (const outcome of await Promise.all(outcomes))
      expect(outcome).toBeInstanceOf(EngineWorkDropped);
    expect(pace.status()).toMatchObject({ queued: 0, dropped: 2 });
    // While it may not send, nothing new goes either (not even what would fit at once).
    await expect(pace.take(80)).rejects.toBeInstanceOf(EngineWorkDropped);
    state.allowed = true;
    expect(pace.take(80)).toBeNull();
  });

  it("a waiter asked under other settings is dropped at its turn; drop() rejects every waiter at once", async () => {
    const { state, rule: sendRule } = rule();
    const pace = new CreditPacer(80, Date.now, () => sendRule);
    expect(pace.take(80)).toBeNull();
    const stale = pace.take(80) as Promise<void>;
    state.generation = 2;
    const current = pace.take(80) as Promise<void>;
    const settledStale = stale.then(
      () => "sent",
      (error: unknown) => error
    );
    const settledCurrent = current.then(() => "sent");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settledStale).toBeInstanceOf(EngineWorkDropped);
    expect(await settledCurrent).toBe("sent");
    // drop(): what waits now is rejected at once, before its turn.
    const waiting = [pace.take(80), pace.take(80)].map((wait) =>
      (wait as Promise<void>).then(
        () => "sent",
        (error: unknown) => error
      )
    );
    pace.drop();
    expect(pace.status().queued).toBe(0);
    for (const outcome of await Promise.all(waiting))
      expect(outcome).toBeInstanceOf(EngineWorkDropped);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pace.status().dropped).toBe(3);
  });

  // viem retries a request that failed with an unknown error (twice, 0.5 s and 1 s later): each
  // retry asks the pacer again. A retry of the engine's work started under the settings before is
  // never sent (to the data source those settings named), even while someone uses the app.
  for (const via of [
    "the engine's own client (paceAsEngine)",
    "a shared client (paceEngineRequest)",
  ]) {
    it(`a viem request the pacer dropped across a settings change is not sent by viem's retries: ${via}`, async () => {
      const { state, rule: sendRule } = rule();
      previous = allowEngineWorkWhen(sendRule);
      readRateFrom(() => 450);
      const sent: string[] = [];
      vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const calls = (Array.isArray(body) ? body : [body]) as { id: number; method: string }[];
        sent.push(...calls.map((call) => call.method));
        const answers = calls.map((call) => ({ jsonrpc: "2.0", id: call.id, result: "0x1" }));
        return new Response(JSON.stringify(Array.isArray(body) ? answers : answers[0]), {
          headers: { "content-type": "application/json" },
        });
      });
      const client = createPublicClient({
        transport: limitedHttp("http://127.0.0.1:9", {
          label: "L1",
          maxInFlight: 4,
          pace: via.includes("paceAsEngine") ? paceAsEngine : paceEngineRequest,
        }),
      });
      // The second's credits are used up: the engine's request waits its turn.
      pacer().debit(450);
      const read = asEngineWork(() => client.getBlockNumber({ cacheTime: 0 })).then(
        () => "answered",
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(pacer().status().queued).toBe(1);
      // The settings change; someone still uses the app (the engine may send).
      state.generation = 2;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sent).toEqual([]);
      expect(await read).not.toBe("answered");
      // Under the new settings, the engine's work goes.
      const next = asEngineWork(() => client.getBlockNumber({ cacheTime: 0 }));
      await vi.advanceTimersByTimeAsync(100);
      expect(await next).toBe(1n);
      expect(sent).toEqual(["eth_blockNumber"]);
    });
  }
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

describe("R-D3 at the default pace: the engine's work waiting its turn when use ends", () => {
  beforeEach(() => {
    clearCache();
    resetRpcClients();
    resetSafeClient();
    resetPresence({ keepWarmMs: 30_000 });
    resetVerdicts();
  });

  afterEach(() => {
    stopSync();
    flags.aggregateOff = false;
    overrideCodePinsForTests(undefined);
    resetPresence();
  });

  // Where every verdict is asked directly (no pins: Sepolia, an override; or the fast path off),
  // a block's work for six sets on screen takes seconds at 450 credits/s: the leave comes while
  // most of it waits in the pacer. None of it is sent afterwards.
  for (const mode of ["no pins (every verdict direct)", "SYNC_VERDICT_AGGREGATE=0"] as const) {
    it(`${mode}: nothing is sent later than 2 s after the last tab left, and what waited is dropped`, async () => {
      overrideCodePinsForTests(mode.startsWith("no pins") ? null : FAKE_PINS);
      flags.aggregateOff = mode === "SYNC_VERDICT_AGGREGATE=0";
      readRateFrom(() => 0);
      const w = liveWorld();
      await backfilled();
      await settle(governance());
      await vi.advanceTimersByTimeAsync(1_500);
      for (const set of w.sets) await settle(verifySignatureSet(set));
      const beat = (reason: "interval" | "leave") =>
        presence().beat({
          tab: "t",
          reason,
          items: reason === "leave" ? [] : w.sets.map((set) => watchSignatureSet(set)),
        });
      beat("interval");
      readRateFrom(() => 450);
      const engine = liveEngine({
        pacePoll: (withFinalized) =>
          pacer().take(creditsOf("eth_getBlockByNumber") * (withFinalized ? 2 : 1)),
      });
      engine.resume();
      await until(() => engine.status().ticks >= 1, 30_000);
      for (let i = 0; i < 3; i++) {
        w.nextBlock();
        await vi.advanceTimersByTimeAsync(SLOT_MS);
        beat("interval");
      }
      // A new block: its work waits its turn in the pacer.
      w.nextBlock();
      await until(() => pacer().status().queued > 0, 13_000);
      beat("leave");
      const endedAt = Date.now();
      expect(presence().inUse()).toBe(false);
      const from = w.fake.posts.length;
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      const late = w.fake.posts.slice(from).filter((post) => post.startedAt - endedAt > 2_000);
      expect(late.map((post) => post.calls.map((call) => call.method))).toEqual([]);
      expect(pacer().status()).toMatchObject({ queued: 0 });
      expect(pacer().status().dropped).toBeGreaterThan(0);
      expect(engine.active).toBe(false);
      // What the leave cut short is not reported as a failure of the data source.
      expect(engine.status().lastTick?.failedSteps).toEqual([]);
    }, 60_000);
  }
});
