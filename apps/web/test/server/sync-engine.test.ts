import { clearCache, invalidate, remainingMs } from "@/.server/cache";
import { puhIndex } from "@/.server/chain/puh-index";
import { getStandardUpgradeCore, listStandardUpgrades } from "@/.server/flows/standard";
import { GOVERNANCE_KEY, governance, safeInfo } from "@/.server/governance";
import {
  type BlockRef,
  type PolledHead,
  chainHead,
  latestBlock,
  network,
  pollHead,
  resetRpcClients,
  rpcGeneration,
} from "@/.server/rpc";
import { resetUpstreamCost } from "@/.server/sync/cost";
import {
  StepSkipped,
  SyncEngine,
  type SyncEngineOptions,
  type Tick,
  type TickStep,
  governanceDue,
  liveSteps,
  noteRequest,
  startSync,
  stopSync,
  syncEngineStatus,
} from "@/.server/sync/engine";
import { type RequestInfo, presence, resetPresence } from "@/.server/sync/presence";
import { listSafeMessages, safeStoreStatus } from "@/.server/safe/store";
import type { SafeMessage } from "@/.server/safe-api";
import {
  PRECOMPUTE_CONCURRENCY,
  type SignatureSetParams,
  signatureSetsStatus,
  verifySignatureSet,
  watchSignatureSet,
} from "@/.server/signatures";
import { currentUpgradeStatus, upgradeStatusKey } from "@/.server/upgrade-status";
import { type UpgradeProposal, encodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { safeMessageHashes } from "@/common/safe";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Hex, numberToHex, pad, zeroAddress, zeroHash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainLog, PUH_TOPICS, blockHash, puhHistory } from "../support/fake-chain";
import { FakeRpcError } from "../support/fake-jsonrpc";
import {
  type FakeL1Options,
  G_MEMBERS,
  L1,
  SC_MEMBERS,
  type UpgradeOnChain,
  fakeL1,
} from "../support/fake-l1";

// The sync engine: an activity window, a head follower that knows when no newer block can exist
// yet, and a tick per new head that refills the caches requests read (head, governance, upgrade
// states keyed by the head's hash, Safe info). The first part drives the engine's schedule with
// stub dependencies; the second runs the live modules against a fake L1 node.

const NOW = 1_800_000_000_000;
const SLOT = 12_000;

beforeEach(() => {
  resetPresence({ keepWarmMs: 600_000 });
});

afterEach(() => {
  stopSync();
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A page load (presence.ts): someone uses the app from now, and the engine wakes for it. */
function touch(engine: SyncEngine) {
  presence().load();
  engine.resume();
}

/** What the server shows the engine about a request (server/index.ts). */
const request = (path: string, headers: Record<string, string> = {}): RequestInfo => ({
  method: "GET",
  path,
  header: (name) => headers[name],
});

// ---- schedule and lifecycle, with stub dependencies ----

type StubHead = { number: bigint; hash: Hex; timestamp: bigint };

function stubChain(
  head: Partial<StubHead> & { timestamp: bigint },
  { pollMs = 0 }: { pollMs?: number } = {}
) {
  const chain = {
    head: { number: 100n, hash: blockHash(100n), ...head } as StubHead,
    /** The 'finalized' answer: blocks behind the head. */
    finalizedLag: 80n,
    generation: 1,
    polls: [] as { at: number; withFinalized: boolean }[],
    confirms: [] as number[],
    /** Heads served (published), with the time. */
    served: [] as { at: number; number: bigint }[],
    inFlight: 0,
    peak: 0,
  };
  const pollHead = async ({ withFinalized }: { withFinalized: boolean }): Promise<PolledHead> => {
    chain.polls.push({ at: Date.now(), withFinalized });
    chain.inFlight++;
    chain.peak = Math.max(chain.peak, chain.inFlight);
    const generation = chain.generation;
    try {
      if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
      const head: BlockRef = { ...chain.head, parentHash: zeroHash };
      return {
        head,
        finalized: withFinalized
          ? { ...head, number: head.number - chain.finalizedLag, hash: blockHash(1n) }
          : undefined,
        generation,
        answeredAt: Date.now(),
        boundary: async () => head.number - chain.finalizedLag,
        isNewest: () => true,
        publish: () => {
          chain.served.push({ at: Date.now(), number: head.number });
          return true;
        },
        confirm: () => {
          chain.confirms.push(Date.now());
          return true;
        },
      };
    } finally {
      chain.inFlight--;
    }
  };
  return { chain, pollHead };
}

function stubEngine(
  pollHeadFn: SyncEngineOptions["pollHead"],
  {
    keepWarmMs,
    ...options
  }: Partial<SyncEngineOptions> & { currentGeneration?: () => number; keepWarmMs?: number } = {}
) {
  // SYNC_KEEPWARM_MS for this test.
  if (keepWarmMs !== undefined) resetPresence({ keepWarmMs });
  return new SyncEngine({
    mode: "window",
    inUse: () => presence().inUse(),
    generation: 1,
    currentGeneration: () => 1,
    network: async () => ({ isDevNode: false, name: "mainnet", blockTimeSeconds: 12 }),
    pollHead: pollHeadFn,
    steps: [],
    ...options,
  });
}

/** Seconds of the fake clock, as a block timestamp. */
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));

/**
 * Starts `engine` mid-slot on head n−1, so that its poll when head n's slot begins (by the local
 * clock) still finds n−1: the proof that the clock is not behind, which lets head n be confirmed
 * by the clock. Head n appears 500 ms into its slot and is seen by the next poll, a second after
 * the slot began. Returns T, head n's timestamp in ms.
 */
async function bootBeforeSlot(
  chain: ReturnType<typeof stubChain>["chain"],
  engine: SyncEngine,
  n: bigint
): Promise<number> {
  const T = Date.now() + 6_000;
  chain.head = { number: n - 1n, hash: blockHash(n - 1n), timestamp: BigInt((T - SLOT) / 1000) };
  touch(engine);
  await vi.advanceTimersByTimeAsync(T + 500 - Date.now());
  chain.head = { number: n, hash: blockHash(n), timestamp: BigInt(T / 1000) };
  await vi.advanceTimersByTimeAsync(T + 1_000 - Date.now());
  expect(engine.status().head?.number).toBe(n.toString());
  return T;
}

describe("activity window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("polls nothing while nobody uses the app, and leaves no timer behind", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() });
    const engine = stubEngine(pollHead);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(chain.polls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.status()).toMatchObject({ mode: "window", active: false, polls: 0, ticks: 0 });
  });

  it("starts on a request, stops once idle for SYNC_KEEPWARM_MS, and starts again on the next", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const engine = stubEngine(pollHead, { keepWarmMs: 30_000 });
    touch(engine);
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.polls).toHaveLength(1);
    expect(engine.status().active).toBe(true);

    await vi.advanceTimersByTimeAsync(40_000);
    expect(engine.status().active).toBe(false);
    // Every timer stopped: nothing more is asked while idle.
    expect(vi.getTimerCount()).toBe(0);
    const idle = chain.polls.length;
    expect(chain.polls.every((p) => p.at - NOW <= 30_000 + SLOT)).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(chain.polls).toHaveLength(idle);

    // The next request starts it again (that request itself reads on demand).
    touch(engine);
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.polls).toHaveLength(idle + 1);
    expect(engine.status().active).toBe(true);
  });

  it("I-5: a poll answered after use ended starts no tick, and nothing is asked after it", async () => {
    // Polls take 4 s; the app counts as in use for 3 s after the page load.
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n }, { pollMs: 4_000 });
    const ran: bigint[] = [];
    const engine = stubEngine(pollHead, {
      keepWarmMs: 3_000,
      steps: [
        {
          name: "probe",
          beforePublish: true,
          run: async (tick) => void ran.push(tick.head.number),
        },
      ],
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(1);
    expect(chain.polls).toHaveLength(1);
    // Use ends while the poll is out; its answer comes a second later.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ran).toEqual([]);
    expect(engine.status()).toMatchObject({ active: false, ticks: 0, head: null });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(chain.polls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a head poll waiting its turn in the credit pacer when use ends is never sent", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    let gated = false;
    let release: (() => void) | null = null;
    const engine = stubEngine(pollHead, {
      keepWarmMs: 30_000,
      pacePoll: () =>
        gated
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : null,
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(chain.polls.length).toBeGreaterThan(0);
    // From now on every poll waits for the pacer; use ends (30 s after the load) while one waits.
    gated = true;
    await vi.advanceTimersByTimeAsync(28_000);
    expect(release).not.toBeNull();
    expect(presence().inUse()).toBe(false);
    const sent = chain.polls.length;
    (release as unknown as () => void)();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(chain.polls).toHaveLength(sent);
    expect(engine.status().active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a step waiting for an older head's run does not start once use ended", async () => {
    let release: () => void = () => {};
    const ran: bigint[] = [];
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const engine = stubEngine(pollHead, {
      keepWarmMs: 20_000,
      steps: [
        {
          name: "slow",
          run: async (tick) => {
            ran.push(tick.head.number);
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        },
      ],
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toEqual([100n]);
    // A newer head while the step is still busy with the first: it waits for its turn.
    chain.head = { number: 101n, hash: blockHash(101n), timestamp: nowSeconds() };
    await vi.advanceTimersByTimeAsync(3_000);
    // Use ends; then the first run finishes: the waiting run never starts.
    await vi.advanceTimersByTimeAsync(20_000);
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toEqual([100n]);
    expect(engine.status().active).toBe(false);
  });

  it("keeps running without requests in SYNC_MODE=always", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const engine = stubEngine(pollHead, { mode: "always", keepWarmMs: 1_000 });
    engine.resume();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(engine.status().active).toBe(true);
    expect(chain.polls.length).toBeGreaterThan(60 * 5);
  });

  it("does nothing in SYNC_MODE=off", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() });
    const engine = stubEngine(pollHead, { mode: "off" });
    touch(engine);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chain.polls).toHaveLength(0);
    expect(engine.status()).toMatchObject({ mode: "off", reason: "SYNC_MODE=off", active: false });
  });

  it("in SYNC_MODE=always never stops, and tells its steps whether someone is viewing", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const seen: { block: bigint; viewing: boolean }[] = [];
    const engine = stubEngine(
      async (options) => {
        // A new block every poll, so every poll is a tick.
        chain.head = {
          ...chain.head,
          number: chain.head.number + 1n,
          hash: blockHash(chain.head.number + 1n),
        };
        return pollHead(options);
      },
      {
        mode: "always",
        keepWarmMs: 30_000,
        steps: [
          {
            name: "probe",
            run: async (tick) => {
              seen.push({ block: tick.head.number, viewing: tick.viewing });
            },
          },
        ],
      }
    );
    // Started by the server, not by a request: following the head, nobody viewing.
    engine.resume();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(engine.status()).toMatchObject({ mode: "always", active: true, cost: { mode: "idle" } });
    expect(engine.viewing).toBe(false);
    // Polls every 2 s for the whole day (no idle stop).
    expect(chain.polls.length).toBeGreaterThan(40_000);
    expect(chain.polls.at(-1)?.at).toBeGreaterThan(NOW + 24 * 60 * 60_000 - 3_000);
    expect(seen.length).toBeGreaterThan(40_000);
    expect(seen.every((s) => !s.viewing)).toBe(true);

    // A request: viewing for SYNC_KEEPWARM_MS, then idle again, still following the head.
    touch(engine);
    expect(engine.status().cost.mode).toBe("viewing");
    const from = seen.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen.slice(from).every((s) => s.viewing)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(engine.status()).toMatchObject({ active: true, cost: { mode: "idle" } });
    const later = seen.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen.length).toBeGreaterThan(later);
    expect(seen.slice(later).every((s) => !s.viewing)).toBe(true);
    engine.stop();
  });

  it("is off on a dev node: requests read on demand", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() });
    const engine = stubEngine(pollHead, {
      network: async () => ({ isDevNode: true, name: "local", blockTimeSeconds: 12 }),
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chain.polls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.status()).toMatchObject({ mode: "off", reason: "dev node", active: false });
    touch(engine);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chain.polls).toHaveLength(0);
  });
});

describe("head follower", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  /** Poll times in ms after the slot of block `T` began. */
  const sinceSlot = (polls: { at: number }[], slotStart: number) =>
    polls.map((p) => p.at - slotStart);

  it("confirms by the clock only after a poll proved it, then asks every second from the next slot, and every 2 s once a slot was missed", async () => {
    // Head 500 was produced 1 s ago.
    const T = NOW - 1_000;
    const { chain, pollHead } = stubChain({ number: 500n, timestamp: BigInt(T / 1000) });
    const engine = stubEngine(pollHead);
    touch(engine);
    // Nothing shows yet that the local clock is not behind the chain's: the node is asked every
    // 2 s, the last time exactly when the next slot begins (T + 12 s), then every second.
    await vi.advanceTimersByTimeAsync(T + 14_500 - Date.now());
    expect(sinceSlot(chain.polls, T)).toEqual([
      1_000, 3_000, 5_000, 7_000, 9_000, 11_000, 12_000, 13_000, 14_000,
    ]);
    expect(chain.confirms).toEqual([]);
    // 501 appears late, at T + 14.5 s. The poll sent at T + 12 s, when its slot had begun by the
    // local clock, still found 500: the clock is behind by less than 501 took to reach the node.
    chain.head = { number: 501n, hash: blockHash(501n), timestamp: BigInt((T + SLOT) / 1000) };
    await vi.advanceTimersByTimeAsync(T + 15_000 - Date.now());
    expect(engine.status().head).toMatchObject({ number: "501" });
    // So 502 cannot exist before T + 24 s: 501 is re-confirmed every 2 s without asking the node.
    await vi.advanceTimersByTimeAsync(T + 24_000 - 1 - Date.now());
    expect(chain.polls).toHaveLength(10);
    expect(
      sinceSlot(
        chain.confirms.map((at) => ({ at })),
        T
      )
    ).toEqual([17_000, 19_000, 21_000, 23_000]);
    // Then the slot is missed (no 502): every second until T + 36 s, then every 2 s.
    await vi.advanceTimersByTimeAsync(T + 41_000 - Date.now());
    expect(sinceSlot(chain.polls, T).slice(9)).toEqual([
      15_000, 24_000, 25_000, 26_000, 27_000, 28_000, 29_000, 30_000, 31_000, 32_000, 33_000,
      34_000, 35_000, 36_000, 38_000, 40_000,
    ]);
    // Each poll re-confirmed the head: it never went more than 2 s unconfirmed.
    expect(engine.status().head?.ageMs).toBeLessThanOrEqual(2_000);
  });

  it.each([
    ["the head is older than two slots (a lagging RPC or a clock ahead)", -30_000],
    ["the local clock is behind the chain", 5_000],
  ])("polls every 2 s when %s", async (_, offset) => {
    const { chain, pollHead } = stubChain({ timestamp: BigInt((NOW + offset) / 1000) });
    const engine = stubEngine(pollHead);
    touch(engine);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sinceSlot(chain.polls, NOW)).toEqual([0, 2_000, 4_000, 6_000, 8_000, 10_000]);
    expect(chain.confirms).toEqual([]);
  });

  it("polls every 2 s on chains without a known slot schedule", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() });
    const engine = stubEngine(pollHead, {
      network: async () => ({ isDevNode: false, name: "local", blockTimeSeconds: 12 }),
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sinceSlot(chain.polls, NOW)).toEqual([0, 2_000, 4_000, 6_000]);
  });

  it("never stacks a slow poll: the next one starts after it answers", async () => {
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 30n }, { pollMs: 5_000 });
    const engine = stubEngine(pollHead);
    touch(engine);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(chain.peak).toBe(1);
    // 5 s per poll, then 2 s until the next.
    expect(sinceSlot(chain.polls, NOW)).toEqual([0, 7_000, 14_000, 21_000, 28_000]);
    expect(engine.status().polls).toBe(5);
  });

  it("asks for 'finalized' every 32 blocks, or whenever the tail above it would pass 128", async () => {
    const { chain, pollHead } = stubChain({ number: 1_000n, timestamp: nowSeconds() - 30n });
    const engine = stubEngine(pollHead);
    touch(engine);
    // A new block for every poll (every 2 s here). From the 40th block on, finality stalls: the
    // next answer (at the 32-block mark) is 200 blocks behind, so every poll after it asks again.
    for (let i = 1; i <= 70; i++) {
      await vi.advanceTimersByTimeAsync(i === 1 ? 0 : 2_000);
      if (i === 40) chain.finalizedLag = 200n;
      chain.head = {
        ...chain.head,
        number: chain.head.number + 1n,
        hash: blockHash(1_000n + BigInt(i)),
      };
    }
    const asked = chain.polls.flatMap((p, i) => (p.withFinalized ? [i] : []));
    expect(asked).toEqual([0, 32, 64, 65, 66, 67, 68, 69]);
  });

  it("keeps polling (every 2 s) through failed polls, and confirms nothing it did not read", async () => {
    let failing = true;
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const engine = stubEngine(async (options) => {
      if (failing) {
        chain.polls.push({ at: Date.now(), withFinalized: options.withFinalized });
        throw new Error("upstream");
      }
      return pollHead(options);
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sinceSlot(chain.polls, NOW)).toEqual([0, 2_000, 4_000]);
    expect(engine.status().head).toBeNull();
    failing = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.status().head).not.toBeNull();
  });

  it("never goes back to an older head that a lagging backend names", async () => {
    const ticked: bigint[] = [];
    const { chain, pollHead } = stubChain({ number: 10n, timestamp: nowSeconds() - 30n });
    const engine = stubEngine(pollHead, {
      steps: [
        {
          name: "status",
          beforePublish: true,
          run: async (tick) => {
            ticked.push(tick.head.number);
          },
        },
      ],
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(0);
    chain.head = { ...chain.head, number: 11n, hash: blockHash(11n) };
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.status().head?.number).toBe("11");
    // The next poll reaches a backend still at 10 (its answer still says it is the newest).
    chain.head = { ...chain.head, number: 10n, hash: blockHash(10n) };
    await vi.advanceTimersByTimeAsync(2_000);
    expect(engine.status().head?.number).toBe("11");
    chain.head = { ...chain.head, number: 11n, hash: blockHash(11n) };
    await vi.advanceTimersByTimeAsync(2_000);
    await engine.settled();
    // 10 was neither ticked nor served again.
    expect(ticked).toEqual([10n, 11n]);
    expect(chain.served.filter((s) => s.at >= NOW + 2_000).map((s) => s.number)).toEqual([
      11n,
      11n,
    ]);
  });
});

// The clock shortcut against a local clock that runs behind real time: a simulated chain with
// 12 s slots, a node that has block n `propagation(n)` ms after its slot began, and requests that
// read the served head (4 s per publication or confirmation, as rpc.ts serves it) or, when there
// is none, the node itself (today's path).
describe("head follower vs the local clock", () => {
  // Real time of block 0's slot.
  const GENESIS = 1_800_000_000_000;

  function slotSim(lagMs: number, propagation: (n: bigint) => number) {
    const real = () => Date.now() + lagMs;
    const appearsAt = (n: bigint) => GENESIS + Number(n) * SLOT + propagation(n);
    const visible = () => {
      let n = BigInt(Math.floor((real() - GENESIS) / SLOT));
      while (appearsAt(n) > real()) n--;
      return n;
    };
    const block = (n: bigint): BlockRef => ({
      number: n,
      hash: blockHash(n),
      parentHash: zeroHash,
      timestamp: BigInt((GENESIS + Number(n) * SLOT) / 1000),
    });
    let newest: bigint | null = null;
    let served: { n: bigint; until: number } | null = null;
    const sim = {
      confirms: 0,
      /** Heads confirmed by the clock while a newer block was already at the node. */
      wrong: new Set<bigint>(),
      real,
      visible,
      appearsAt,
      pollHead: async (): Promise<PolledHead> => {
        const head = block(visible());
        const answeredAt = Date.now();
        return {
          head,
          finalized: undefined,
          generation: 1,
          answeredAt,
          boundary: async () => head.number - 64n,
          isNewest: () => newest === null || head.number >= newest,
          publish: () => {
            if (newest !== null && head.number < newest) return false;
            newest = head.number;
            served = { n: head.number, until: answeredAt + 4_000 };
            return true;
          },
          confirm: () => {
            if (newest !== null && newest !== head.number) return false;
            sim.confirms++;
            if (visible() > head.number) sim.wrong.add(head.number);
            served = { n: head.number, until: Date.now() + 4_000 };
            return true;
          },
        };
      },
      /** The head a request gets now. */
      request: (): bigint => {
        if (served && served.until > Date.now()) return served.n;
        const n = visible();
        if (newest === null || n > newest) newest = n;
        served = { n, until: Date.now() + 4_000 };
        return n;
      },
    };
    return sim;
  }

  /**
   * Starts the engine `startInSlotMs` into a slot (real time), lets it settle, then makes a
   * request every 100 ms for 5 minutes. `worst`: how long before a request the block after the
   * head it got had appeared (0 when it got the newest). `tickMs`: how long reading what requests
   * need at a new head takes (the live steps: the index tail, one aggregate3). `settleMs`: how
   * long the engine runs before requests are made.
   */
  async function follow(
    lagMs: number,
    startInSlotMs: number,
    propagation: (n: bigint) => number,
    {
      tickMs = 0,
      settleMs = 30_000,
      headPoll = "slot",
    }: { tickMs?: number; settleMs?: number; headPoll?: "slot" | "late" } = {}
  ) {
    vi.setSystemTime(GENESIS + 1_000 * SLOT + startInSlotMs - lagMs);
    const sim = slotSim(lagMs, propagation);
    const steps: TickStep[] =
      tickMs > 0
        ? [
            {
              name: "status",
              beforePublish: true,
              run: () => new Promise((resolve) => setTimeout(resolve, tickMs)),
            },
          ]
        : [];
    const engine = stubEngine(sim.pollHead, { mode: "always", steps, headPoll });
    engine.resume();
    await vi.advanceTimersByTimeAsync(settleMs);
    const pollsBefore = engine.status().polls;
    let worst = 0;
    for (let i = 0; i < 3_000; i++) {
      await vi.advanceTimersByTimeAsync(100);
      const got = sim.request();
      if (got < sim.visible()) worst = Math.max(worst, sim.real() - sim.appearsAt(got + 1n));
    }
    const polls = engine.status().polls - pollsBefore;
    const clock = engine.status().clock;
    engine.stop();
    return { worst, polls, confirms: sim.confirms, wrong: sim.wrong.size, clock };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("with the clock right, confirms by the clock and asks the node about twice a slot", async () => {
    const result = await follow(0, 5_000, () => 1_000);
    expect(result.wrong).toBe(0);
    expect(result.worst).toBeLessThanOrEqual(1_000);
    expect(result.confirms).toBeGreaterThan(100);
    // 25 slots in 5 minutes.
    expect(result.polls).toBeLessThanOrEqual(2 * 25 + 1);
  });

  it.each([
    [3_000, 5_000],
    [5_000, 11_500],
    [8_000, 5_000],
    [8_000, 11_500],
    [11_000, 11_900],
  ])(
    "with the clock %i ms behind (first poll %i ms into a slot), never confirms a replaced head",
    async (lagMs, startInSlotMs) => {
      const result = await follow(lagMs, startInSlotMs, () => 1_000);
      expect(result.wrong).toBe(0);
      expect(result.confirms).toBe(0);
      // As without the engine: the head a request gets is at most 4 s behind.
      expect(result.worst).toBeLessThanOrEqual(4_000);
    }
  );

  it("stops trusting the clock after one confirmation it may have got wrong", async () => {
    // The clock is 2 s behind; blocks alternate between reaching the node 3 s and 0.5 s into
    // their slot. A late block proves the clock (it was not there when its slot began by the
    // local clock), but the early block after it is there 1.5 s before that slot begins by the
    // local clock. Once seen, the clock is not trusted again for the next 10 minutes.
    const result = await follow(2_000, 2_500, (n) => (n % 2n === 0n ? 3_000 : 500));
    // The first late block opened a window, and the early block after it showed it wrong: that
    // one confirmation, then none (without the distrust, one for every second block).
    expect(result.wrong).toBe(1);
    expect(result.confirms).toBeLessThanOrEqual(5);
    expect(result.worst).toBeLessThanOrEqual(4_000);
  });

  it("serves the next head at once after a confirmation it may have got wrong, however slow its tick", async () => {
    // The clock is 2.9 s behind; blocks alternate between reaching the node 3 s and 0.1 s into
    // their slot, and reading what requests need at a new head takes 1.9 s. The early block is
    // at the node when its slot begins by the local clock, while the late one before it is
    // still confirmed by the clock: it replaces that head at once, not after its tick (which
    // would leave the old head served 4.6 s after the new one appeared). Requests from the start:
    // this happens once, soon after the engine starts.
    const result = await follow(2_900, 2_500, (n) => (n % 2n === 0n ? 3_000 : 100), {
      tickMs: 1_900,
      settleMs: 0,
    });
    expect(result.wrong).toBe(1);
    expect(result.worst).toBeLessThanOrEqual(4_000);
  });

  it("SYNC_HEAD_POLL=late: after the proof poll, the first search poll goes where blocks have arrived by: fewer polls a slot, nothing confirmed wrongly, the same bounds", async () => {
    // Blocks reach the node 1.6-2.4 s into their slot.
    const arrival = (n: bigint) => 1_600 + Number(n % 5n) * 200;
    const slot = await follow(0, 5_000, arrival, { settleMs: 120_000 });
    const late = await follow(0, 5_000, arrival, { settleMs: 120_000, headPoll: "late" });
    for (const result of [slot, late]) {
      expect(result.wrong).toBe(0);
      expect(result.worst).toBeLessThanOrEqual(4_000);
    }
    expect(slot.clock).toMatchObject({ headPoll: "slot", firstPollMs: null });
    // Learned from slots searched every second: the 80th percentile of when polls found blocks.
    expect(late.clock.headPoll).toBe("late");
    expect(late.clock.samples).toBeGreaterThanOrEqual(8);
    expect(late.clock.firstPollMs).toBeGreaterThanOrEqual(2_000);
    expect(late.clock.firstPollMs).toBeLessThanOrEqual(3_000);
    // 25 slots in 5 minutes: three polls a slot (start, +1 s, +2 s) against about two.
    expect(slot.polls).toBeGreaterThanOrEqual(3 * 25 - 2);
    expect(late.polls).toBeLessThan(slot.polls);
    expect(late.polls).toBeLessThanOrEqual(Math.ceil(2.3 * 25));
    expect(late.clock.recent.pollsPerBlock).toBeLessThan(slot.clock.recent.pollsPerBlock ?? 0);
  });

  it("SYNC_HEAD_POLL=late never waits past the head's 4 s: its first search poll stays inside them", async () => {
    // Blocks reach the node 3.8 s into their slot: the search poll would go later than the head
    // the proof poll confirmed stays served, so it goes 4 s minus the polls' time and a margin in.
    const result = await follow(0, 5_000, () => 3_800, { settleMs: 120_000, headPoll: "late" });
    expect(result.wrong).toBe(0);
    expect(result.worst).toBeLessThanOrEqual(4_000);
    expect(result.clock.firstPollMs).toBeLessThanOrEqual(3_500);
  });

  it("trusts a correct clock again right after a pause", async () => {
    vi.setSystemTime(GENESIS + 1_000 * SLOT + 5_000);
    // Blocks reach the node 200 ms into their slot.
    const sim = slotSim(0, () => 200);
    const engine = stubEngine(sim.pollHead, { keepWarmMs: 60_000 });
    // Someone uses the app for 5 minutes.
    const session = async () => {
      const polls = engine.status().polls;
      const confirms = sim.confirms;
      for (let i = 0; i < 10; i++) {
        touch(engine);
        await vi.advanceTimersByTimeAsync(30_000);
      }
      return { polls: engine.status().polls - polls, confirms: sim.confirms - confirms };
    };
    const before = await session();
    // Nobody for 20 minutes: the engine stops. The next request comes 500 ms into a slot, so the
    // first poll after the pause finds a block that was at the node when its slot began: no sign
    // about the clock after a pause, whatever the head before it.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(engine.status().active).toBe(false);
    const slotStart = GENESIS + Math.ceil((Date.now() - GENESIS) / SLOT) * SLOT;
    await vi.advanceTimersByTimeAsync(slotStart + 500 - Date.now());
    // The first head after the pause shows nothing about the clock: from the next slot on it is
    // confirmed by the clock as before, and the node is asked about twice a slot (25 slots, a
    // few more until a poll proves the clock again), not every second or two (~175 polls).
    const after = await session();
    expect(before.confirms).toBeGreaterThan(100);
    expect(after.confirms).toBeGreaterThan(100);
    expect(after.polls).toBeLessThanOrEqual(2 * 25 + 6);
    expect(sim.wrong.size).toBe(0);
    engine.stop();
  });

  it("keeps trusting a correct clock after a failed poll at a slot boundary", async () => {
    vi.setSystemTime(GENESIS + 1_000 * SLOT + 5_000);
    const sim = slotSim(0, () => 1_000);
    // The poll sent when slot 1010 begins fails; the next one, 2 s later, finds block 1010.
    const failingSlot = GENESIS + 1_010 * SLOT;
    let failed = 0;
    const engine = stubEngine(
      async () => {
        const now = Date.now();
        if (failed === 0 && now >= failingSlot && now < failingSlot + 1_000) {
          failed++;
          throw new Error("upstream");
        }
        return sim.pollHead();
      },
      { mode: "always" }
    );
    engine.resume();
    await vi.advanceTimersByTimeAsync(failingSlot + 3_000 - Date.now());
    expect(failed).toBe(1);
    const confirms = sim.confirms;
    const polls = engine.status().polls;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // A poll sent 2 s into the slot shows nothing about the clock: no 10 minutes of distrust.
    expect(sim.confirms - confirms).toBeGreaterThan(100);
    expect(engine.status().polls - polls).toBeLessThanOrEqual(2 * 25 + 6);
    expect(sim.wrong.size).toBe(0);
    engine.stop();
  });
});

describe("ticks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  const step = (name: string, run: (tick: Tick) => Promise<void>): TickStep => ({ name, run });

  it("runs every step for a new head; a failing step neither holds up nor fails the others", async () => {
    const done: string[] = [];
    const { pollHead } = stubChain({ number: 7n, timestamp: nowSeconds() - 1n });
    const engine = stubEngine(pollHead, {
      steps: [
        step("governance", async () => {
          throw new Error("-32603 internal error");
        }),
        step("status", async (tick) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          done.push(`status@${tick.head.number}`);
        }),
        step("index", async () => {
          throw new StepSkipped("not ready");
        }),
      ],
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(500);
    await engine.settled();
    expect(done).toEqual(["status@7"]);
    expect(engine.status()).toMatchObject({
      ticks: 1,
      lastTick: { block: "7", failedSteps: ["governance"] },
    });
    expect(engine.status().lastTick?.ms).toBe(300);
  });

  it("serves a new head once the steps requests need have settled, not waiting for the rest", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { chain, pollHead } = stubChain({ timestamp: 0n });
    const engine = stubEngine(pollHead, {
      steps: [
        {
          name: "status",
          beforePublish: true,
          run: async (tick) => (tick.head.number === 7n ? gate : undefined),
        },
        // Slow, and nothing requests at this head wait for.
        step("governance", async (tick) => {
          if (tick.head.number === 7n) await new Promise((resolve) => setTimeout(resolve, 10_000));
        }),
      ],
    });
    const T = await bootBeforeSlot(chain, engine, 7n);
    const served = () => chain.served.filter((s) => s.number === 7n);
    await vi.advanceTimersByTimeAsync(500);
    expect(served()).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(served()).toEqual([{ at: T + 1_500, number: 7n }]);
    // Only head 6's tick has finished.
    expect(engine.status().ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.status()).toMatchObject({
      ticks: 2,
      lastTick: { block: "7", ms: 10_000, failedSteps: [] },
    });
    // Served once; afterwards (until the next slot, at T + 12 s) only confirmed by the clock.
    expect(served()).toHaveLength(1);
    expect(chain.confirms.length).toBeGreaterThan(0);
    expect(chain.confirms.every((at) => at > T + 1_500)).toBe(true);
  });

  it("serves a new head at most 2 s after it was seen, even when its steps hang", async () => {
    const { chain, pollHead } = stubChain({ timestamp: 0n });
    const engine = stubEngine(pollHead, {
      steps: [
        {
          name: "status",
          beforePublish: true,
          run: (tick) => (tick.head.number === 7n ? new Promise(() => {}) : Promise.resolve()),
        },
      ],
    });
    // Seen at T + 1 s.
    const T = await bootBeforeSlot(chain, engine, 7n);
    const served = () => chain.served.filter((s) => s.number === 7n);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(served()).toEqual([]);
    // Nothing is confirmed before it is served.
    expect(chain.confirms).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(served()).toEqual([{ at: T + 3_000, number: 7n }]);
    await vi.advanceTimersByTimeAsync(2_000);
    // Confirmed from then on (never before it was served).
    expect(chain.confirms.at(-1)).toBe(T + 5_000);
    expect(chain.confirms.every((at) => at >= T + 3_000)).toBe(true);
  });

  it("counts a head's age from the node's answer, not from when it was served", async () => {
    let failing = false;
    const { chain, pollHead } = stubChain({ number: 7n, timestamp: nowSeconds() - 30n });
    const engine = stubEngine(
      async (options) => {
        if (failing) throw new Error("upstream");
        return pollHead(options);
      },
      { steps: [{ name: "status", beforePublish: true, run: () => new Promise(() => {}) }] }
    );
    touch(engine);
    await vi.advanceTimersByTimeAsync(0);
    // The node stops answering right after it named head 7.
    failing = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(chain.served).toEqual([{ at: NOW + 2_000, number: 7n }]);
    expect(engine.status().head?.ageMs).toBe(2_000);
  });

  it("a slow step holds up only its own next run: every newer head still gets its other steps, and is served", async () => {
    const slow: bigint[] = [];
    const fast: bigint[] = [];
    const { chain, pollHead } = stubChain({ number: 10n, timestamp: nowSeconds() - 30n });
    const engine = stubEngine(pollHead, {
      steps: [
        step("governance", async (tick) => {
          slow.push(tick.head.number);
          await new Promise((resolve) => setTimeout(resolve, 30_000));
        }),
        {
          name: "status",
          beforePublish: true,
          run: async (tick) => {
            fast.push(tick.head.number);
          },
        },
      ],
    });
    touch(engine);
    // Polls every 2 s; heads 11, 12, 13 arrive while the slow step runs for 10.
    for (const n of [11n, 12n, 13n]) {
      await vi.advanceTimersByTimeAsync(2_000);
      chain.head = { ...chain.head, number: n, hash: blockHash(n) };
    }
    await vi.advanceTimersByTimeAsync(2_000);
    // Each head ran its other step and was served as soon as it was seen.
    expect(fast).toEqual([10n, 11n, 12n, 13n]);
    const first = (n: bigint) => chain.served.find((s) => s.number === n)?.at;
    expect([10n, 11n, 12n, 13n].map(first)).toEqual([NOW, NOW + 4_000, NOW + 6_000, NOW + 8_000]);

    await vi.advanceTimersByTimeAsync(60_000);
    await engine.settled();
    // The slow step ran for 10, then only for the newest head waiting.
    expect(slow).toEqual([10n, 13n]);
    // A tick per head that ran a step; the newest head's is reported, whatever finished last.
    expect(engine.status()).toMatchObject({ ticks: 4, lastTick: { block: "13", failedSteps: [] } });
  });

  it("drops a tick that finishes after the settings changed, and hands over to a new engine", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: boolean[] = [];
    const { chain, pollHead } = stubChain({ timestamp: nowSeconds() - 1n });
    const onSuperseded = vi.fn();
    const engine = stubEngine(pollHead, {
      currentGeneration: () => chain.generation,
      onSuperseded,
      steps: [
        step("governance", async (tick) => {
          await gate;
          // The step writes only while its settings are current.
          writes.push(tick.current());
        }),
      ],
    });
    touch(engine);
    await vi.advanceTimersByTimeAsync(0);
    chain.generation = 2;
    release();
    await engine.settled();
    expect(writes).toEqual([false]);
    expect(engine.status()).toMatchObject({ ticks: 0, lastTick: null });
    // At its next wake the old engine stops and lets the new settings' engine take over.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(engine.status().active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("governanceDue (the idle profile's governance reads)", () => {
  const base = { head: 101n, lastRead: 100n, remainingMs: 18_000, slotMs: SLOT };
  it.each([
    ["while viewing, every block", { ...base, viewing: true }, true],
    ["idle, right after a read with time to spare: skipped", { ...base, viewing: false }, false],
    ["idle, two blocks after the last read", { ...base, viewing: false, head: 102n }, true],
    ["idle, nothing read yet", { ...base, viewing: false, lastRead: null }, true],
    ["idle, nothing served now", { ...base, viewing: false, remainingMs: null }, true],
    [
      "idle, would run out before the next block's read (slot + 4 s)",
      { ...base, viewing: false, remainingMs: 15_999 },
      true,
    ],
    ["idle, exactly a slot + 4 s left", { ...base, viewing: false, remainingMs: 16_000 }, false],
    ["idle, the same height again (a reorg)", { ...base, viewing: false, head: 100n }, true],
    ["idle, a lower head", { ...base, viewing: false, head: 99n }, true],
    [
      "idle, no slot schedule: 12 s assumed",
      { ...base, viewing: false, slotMs: null, remainingMs: 15_000 },
      true,
    ],
  ])("%s", (_name, plan, due) => {
    expect(governanceDue(plan)).toBe(due);
  });
});

// ---- live modules against a fake L1 node ----

const HEAD = 26_129_107n;
const FINAL = HEAD - 80n;
const HEAD_TIME = BigInt(Math.floor(NOW / 1000)) - 1n;
const HASH_A = blockHash(HEAD);
const HASH_B = blockHash(HEAD, 1);

const ACTIVE: UpgradeProposal = {
  calls: [{ target: `0x${"0a".repeat(20)}`, value: "0", data: "0x" }],
  executor: zeroAddress,
  salt: pad(numberToHex(0xac71fe), { size: 32 }) as Hex,
};
const ACTIVE_ID = upgradeProposalId(ACTIVE);
const ACTIVE_STARTED = FINAL - 500n;
const CREATED = Number(1_700_000_000n + ACTIVE_STARTED * 12n);

function liveChain(
  options: Pick<FakeL1Options, "inject" | "gate" | "clientVersion" | "stateAt" | "signatures"> = {}
) {
  const history = puhHistory(L1.deployBlock, FINAL - 1_000n);
  const started: ChainLog = {
    blockNumber: ACTIVE_STARTED,
    logIndex: 0,
    topics: [PUH_TOPICS.UpgradeStarted, ACTIVE_ID],
    data: encodeUpgradeProposal(ACTIVE),
  };
  const upgrades = new Map<string, UpgradeOnChain>();
  for (const upgrade of history.upgrades)
    upgrades.set(upgrade.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [1_700_000_000, 1_700_000_100, false, false, true],
    });
  for (const emergency of history.emergencies)
    upgrades.set(emergency.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [0, 0, false, false, true],
    });
  upgrades.set(ACTIVE_ID.toLowerCase(), {
    state: UPGRADE_STATES.Waiting,
    status: [CREATED, 0, false, false, false],
  });
  const fake = fakeL1({
    head: { number: HEAD, hash: HASH_A, timestamp: HEAD_TIME },
    finalized: FINAL,
    logs: [...history.logs, started],
    upgrades,
    ...options,
  });
  vi.stubGlobal("fetch", fake.fetch);
  const ids = [
    ACTIVE_ID,
    ...history.upgrades.map((u) => u.id),
    ...history.emergencies.map((e) => e.id),
  ];
  return { fake, history, ids };
}

/** Runs the fake clock in small steps until `done` (each step lets batching windows close). */
async function until(done: () => boolean, maxMs = 5_000) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > maxMs) throw new Error("timed out waiting");
    await vi.advanceTimersByTimeAsync(10);
  }
}

function liveEngine(options: Partial<SyncEngineOptions> = {}) {
  return new SyncEngine({
    mode: "window",
    inUse: () => presence().inUse(),
    generation: rpcGeneration(),
    currentGeneration: rpcGeneration,
    network,
    pollHead,
    steps: liveSteps(),
    ...options,
  });
}

/** The handler's index backfilled, as the boot warm-up leaves it. */
async function backfilled() {
  const index = puhIndex();
  void index.startBackfill();
  await until(() => index.status().state === "ready");
}

async function firstTick(engine: SyncEngine, ticks = 1) {
  touch(engine);
  await until(() => engine.status().ticks >= ticks);
  await engine.settled();
}

/** Runs the fake clock until `promise` settles, and returns its value. */
async function settle<T>(promise: Promise<T>, maxMs = 10_000): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  void tracked.catch(() => {});
  await until(() => done, maxMs);
  return tracked;
}

/**
 * Safe's Transaction Service in front of the fake node, holding the member Safes' messages for the
 * Security Council's approval of the active upgrade. `sign(member)` adds that member's message
 * (2 confirmations, the Safe's threshold) and makes the council accept its signature; `view()`
 * verifies the set as the upgrade page does.
 */
async function safeService(fake: ReturnType<typeof fakeL1>, signatures: Set<string>) {
  const gov = await governance();
  const typedData = buildTypedData("ApproveUpgradeSecurityCouncil", gov.securityCouncil.domain, {
    id: ACTIVE_ID,
  });
  const { digest } = governanceHashes(typedData);
  const params: SignatureSetParams = {
    action: "ApproveUpgradeSecurityCouncil",
    signerGroup: "securityCouncil",
    typedData,
    members: [...gov.securityCouncil.members],
    threshold: gov.securityCouncil.thresholds.approveUpgrade,
    check: { kind: "multisig", contract: gov.securityCouncil.address },
  };
  const listings = new Map<string, SafeMessage[]>();
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.safe.global/")) return fake.fetch(input as string, init);
    requests.push(url);
    const safe = /\/safes\/(0x[0-9a-fA-F]{40})\/messages\//.exec(url)?.[1]?.toLowerCase();
    const results = (safe && listings.get(safe)) || [];
    return new Response(JSON.stringify({ count: results.length, results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    requests,
    sign(member: Hex) {
      const at = new Date().toISOString();
      const confirmation = { owner: zeroAddress, signature: "0x01" as Hex, signatureType: "EOA" };
      listings.set(member.toLowerCase(), [
        {
          created: at,
          modified: at,
          safe: member,
          messageHash: safeMessageHashes(1, member, digest).safeMessageHash,
          message: {},
          confirmations: [confirmation, confirmation],
          preparedSignature: "0x01",
        },
      ]);
      signatures.add(`${member}:0x01`.toLowerCase());
    },
    params,
    /** A page shows the set in a visible tab: on screen for the engine. */
    show: () => showOnScreen([params]),
    view: () => verifySignatureSet(params),
  };
}

/** A visible tab shows these sets (pages registered each; the tab beats their keys). */
function showOnScreen(sets: SignatureSetParams[], tab = "tab-under-test") {
  presence().beat({ tab, reason: "interval", items: sets.map((set) => watchSignatureSet(set)) });
}

/** A set of `members` on screen, as a page that shows it registers it. */
const setOf = (
  signerGroup: SignatureSetParams["signerGroup"],
  members: readonly Hex[],
  contract: Hex
): SignatureSetParams => ({
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup,
  typedData: buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: L1.securityCouncil },
    { id: ACTIVE_ID }
  ),
  members: [...members],
  threshold: 1,
  check: { kind: "multisig", contract },
});

// Upgrade state reads at a block (governance's reads are pinned to the head's number too).
const statusCalls = (fake: ReturnType<typeof fakeL1>, block: bigint) =>
  fake.calls.filter(
    (c) =>
      c.block === numberToHex(block) &&
      (c.functionName === "upgradeState" || c.functionName === "upgradeStatus")
  );

describe("live engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clearCache();
    resetRpcClients();
  });

  it("seeds head, governance, upgrade states and the on-screen sets' Safe info: 100 request-path rounds ask nothing upstream", async () => {
    const { fake, ids } = liveChain();
    await backfilled();
    // The council's, the Guardians' and the ZK Foundation's sets on screen.
    showOnScreen([
      setOf("securityCouncil", SC_MEMBERS, L1.securityCouncil),
      setOf("guardians", G_MEMBERS, L1.guardians),
      setOf("zkFoundation", [L1.zkFoundation], L1.zkFoundation),
    ]);
    const engine = liveEngine();
    await firstTick(engine);
    expect(engine.status()).toMatchObject({
      mode: "window",
      active: true,
      head: { number: HEAD.toString(), hash: HASH_A },
      lastTick: { block: HEAD.toString(), failedSteps: [] },
      ticks: 1,
    });
    // Every id's state and status went out in ONE Multicall3 call pinned to the head.
    expect(fake.stateAggregates(numberToHex(HEAD))).toHaveLength(1);
    expect(statusCalls(fake, HEAD)).toHaveLength(2 * ids.length);
    expect(statusCalls(fake, HEAD).every((c) => c.viaMulticall)).toBe(true);

    const before = fake.posts.length;
    const safes = [...SC_MEMBERS, ...G_MEMBERS, L1.zkFoundation];
    for (let round = 0; round < 100; round++) {
      const [head, boundary, gov, statuses, , list, core] = await Promise.all([
        latestBlock(),
        chainHead(),
        governance(),
        Promise.all(ids.map((id) => currentUpgradeStatus(id))),
        Promise.all(safes.map((safe) => safeInfo(safe))),
        listStandardUpgrades({ allHistory: true }),
        getStandardUpgradeCore(ACTIVE_ID),
      ]);
      expect(head.hash).toBe(HASH_A);
      expect(boundary.safe).toBe(FINAL);
      expect(gov.securityCouncil.members).toEqual(SC_MEMBERS);
      expect(statuses[0]?.state).toBe(UPGRADE_STATES.Waiting);
      expect(list.upgrades).toHaveLength(17);
      expect(core.state).toBe(UPGRADE_STATES.Waiting);
    }
    expect(fake.posts.length).toBe(before);
  });

  it("seeds upgrade states when governance fails; governance keeps its last good value only for its 30 s", async () => {
    let failGovernance = false;
    const { fake, ids } = liveChain({
      inject: (call) =>
        failGovernance && call.to === L1.securityCouncil
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    const good = await governance();

    // Next block: every Security Council read fails.
    failGovernance = true;
    vi.setSystemTime(NOW + 12_500);
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    await until(() => engine.status().ticks >= 2);
    await engine.settled();
    expect(engine.status().lastTick).toMatchObject({
      block: (HEAD + 1n).toString(),
      failedSteps: ["governance"],
    });
    const before = fake.posts.length;
    for (let round = 0; round < 100; round++) {
      const statuses = await Promise.all(ids.map((id) => currentUpgradeStatus(id)));
      expect(statuses[0]?.state).toBe(UPGRADE_STATES.Waiting);
      expect((await latestBlock()).number).toBe(HEAD + 1n);
    }
    expect(fake.posts.length).toBe(before);
    // The last good governance is still served, within 30 s of its read, and no longer.
    expect(await governance()).toBe(good);
    const left = remainingMs(GOVERNANCE_KEY);
    expect(left).not.toBeNull();
    expect(left as number).toBeLessThanOrEqual(30_000 - 12_000);
  });

  it("serves a tick's governance for 30 s from the read's answer, however late its head is served", async () => {
    const governanceContracts = new Set<string>([
      L1.securityCouncil,
      L1.guardians,
      L1.emergencyUpgradeBoard,
    ]);
    let answered = 0;
    let failGovernance = false;
    const { fake } = liveChain({
      gate: (call) => {
        if (governanceContracts.has(call.to)) answered = Date.now();
        // HEAD+1's states are held: it is served only at the 2 s deadline.
        return call.block === numberToHex(HEAD + 1n) && call.functionName === "upgradeState"
          ? new Promise<void>(() => {})
          : undefined;
      },
      inject: (call) =>
        failGovernance && governanceContracts.has(call.to)
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);

    vi.setSystemTime(NOW + SLOT + 500);
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    await until(() => engine.status().head?.number === (HEAD + 1n).toString());
    const seenAt = Date.now();
    // Its governance read answers right away, and is stored once the head is served, 2 s later.
    await until(() => Date.now() >= seenAt + 2_100);
    expect((await latestBlock()).number).toBe(HEAD + 1n);
    expect((await governance()).latestBlock.number).toBe((HEAD + 1n).toString());
    expect(answered).toBeGreaterThan(seenAt - 1_000);
    expect(answered).toBeLessThan(seenAt + 500);
    // Every governance read fails from now on: the value stays until 30 s after its answer.
    failGovernance = true;
    const expiresAt = Date.now() + (remainingMs(GOVERNANCE_KEY) as number);
    expect(expiresAt).toBe(answered + 30_000);
    await vi.advanceTimersByTimeAsync(answered + 30_000 - 1 - Date.now());
    expect(remainingMs(GOVERNANCE_KEY)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(remainingMs(GOVERNANCE_KEY)).toBeNull();
  });

  it("keys state by the head's hash: a reorg at the same height is read again", async () => {
    const { fake } = liveChain();
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.Waiting);

    // After the next slot began, block HEAD is replaced by another block at the same height in
    // which the upgrade got the Security Council's approval.
    vi.setSystemTime(NOW + SLOT + 500);
    fake.chain.options.head = { number: HEAD, hash: HASH_B, timestamp: HEAD_TIME + 12n };
    fake.upgrades.set(ACTIVE_ID.toLowerCase(), {
      state: UPGRADE_STATES.ExecutionPending,
      status: [CREATED, CREATED + 100, false, false, false],
    });
    await until(() => engine.status().ticks >= 2);
    await engine.settled();
    expect(engine.status().head).toMatchObject({ number: HEAD.toString(), hash: HASH_B });
    expect(upgradeStatusKey(1, ACTIVE_ID, { hash: HASH_A })).not.toBe(
      upgradeStatusKey(1, ACTIVE_ID, { hash: HASH_B })
    );
    // Read again at the same height: one Multicall3 call per hash.
    expect(fake.stateAggregates(numberToHex(HEAD))).toHaveLength(2);
    const before = fake.posts.length;
    expect((await latestBlock()).hash).toBe(HASH_B);
    expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.ExecutionPending);
    expect(fake.posts.length).toBe(before);
  });

  /** Moves the fake chain `blocks` ahead (12 s each) and lets the engine tick there. */
  async function advanceChain(
    engine: SyncEngine,
    fake: ReturnType<typeof fakeL1>,
    head: bigint,
    finalized: bigint,
    ticks: number
  ) {
    const seconds = (head - HEAD) * 12n;
    vi.setSystemTime(NOW + Number(seconds) * 1000 + 500);
    fake.chain.options.head = {
      number: head,
      hash: blockHash(head),
      timestamp: HEAD_TIME + seconds,
    };
    fake.chain.options.finalized = finalized;
    // Someone is using the app then.
    touch(engine);
    await until(() => engine.status().ticks >= ticks);
    await engine.settled();
  }

  it("keeps serving the previous head (from memory) while the new head's states are read", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fake } = liveChain({
      gate: (call) =>
        call.block === numberToHex(HEAD + 1n) && call.functionName === "upgradeState"
          ? held
          : undefined,
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    // HEAD+1 is produced at the next slot; the engine asks the node then.
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    fake.upgrades.set(ACTIVE_ID.toLowerCase(), {
      state: UPGRADE_STATES.ExecutionPending,
      status: [CREATED, CREATED + 100, false, false, false],
    });
    await until(() => engine.status().head?.number === (HEAD + 1n).toString(), 15_000);
    // Its governance read finishes first, but is stored only once the head is served: governance
    // never names a block newer than the head requests read.
    const governanceReads = () => fake.calls.filter((c) => c.functionName === "securityCouncil");
    await until(() => governanceReads().length === 2);
    await vi.advanceTimersByTimeAsync(100);
    expect((await governance()).latestBlock.number).toBe(HEAD.toString());
    // Its states are being read: requests still get HEAD and what was read for it, from memory.
    const before = fake.posts.length;
    for (let round = 0; round < 10; round++) {
      expect((await latestBlock()).number).toBe(HEAD);
      expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.Waiting);
      expect((await listStandardUpgrades({ allHistory: false })).upgrades.length).toBeGreaterThan(
        0
      );
    }
    expect(fake.posts.length).toBe(before);

    release();
    await until(() => engine.status().ticks >= 2);
    await engine.settled();
    const after = fake.posts.length;
    expect((await latestBlock()).number).toBe(HEAD + 1n);
    expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.ExecutionPending);
    expect((await governance()).latestBlock.number).toBe((HEAD + 1n).toString());
    expect(fake.posts.length).toBe(after);
  });

  it("never serves an orphaned head again once its replacement at the same height was served", async () => {
    const { fake } = liveChain();
    let releaseA: () => void = () => {};
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    // A's tick is slow, and B's waits behind it on the same step.
    const engine = liveEngine({
      steps: [
        {
          name: "status",
          beforePublish: true,
          run: async (tick) => {
            if (tick.head.hash === HASH_A) await heldA;
          },
        },
      ],
    });
    // A is seen 13 s after its timestamp (its successor's slot has begun): polls every second.
    fake.chain.options.head = { number: HEAD, hash: HASH_A, timestamp: HEAD_TIME - 12n };
    touch(engine);
    await until(() => engine.status().head?.hash === HASH_A);
    // A is replaced at the same height by B: the next poll sees it, and its deadline serves it.
    fake.chain.options.head = { number: HEAD, hash: HASH_B, timestamp: HEAD_TIME };
    await until(() => engine.status().head?.hash === HASH_B, 3_000);
    await vi.advanceTimersByTimeAsync(2_100);
    expect((await latestBlock()).hash).toBe(HASH_B);
    // A's tick finishes now: A is never served again.
    releaseA();
    for (let waited = 0; waited < 6_000; waited += 50) {
      await vi.advanceTimersByTimeAsync(50);
      expect((await latestBlock()).hash).toBe(HASH_B);
    }
    await engine.settled();
  });

  it("a slow governance read holds up only governance: every newer head still gets its index tail and states first", async () => {
    let hold = false;
    let held = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fake, ids } = liveChain({
      gate: (call) => {
        if (!hold || call.to !== L1.upgradeHandler || call.functionName !== "securityCouncil")
          return;
        // Only the next governance read (HEAD+1's tick) is held.
        hold = false;
        held = true;
        return gate;
      },
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    hold = true;
    for (const n of [HEAD + 1n, HEAD + 2n, HEAD + 3n]) {
      // Block n reaches the node 500 ms into its slot; from the slot on, the node is asked every
      // second.
      const timestamp = HEAD_TIME + (n - HEAD) * 12n;
      await vi.advanceTimersByTimeAsync(Number(timestamp) * 1000 + 500 - Date.now());
      fake.chain.options.head = { number: n, hash: blockHash(n), timestamp };
      await until(() => engine.status().head?.number === n.toString(), 2_000);
      // Its index tail and states are read within moments, not at the 2 s deadline: requests at
      // n are answered from memory.
      await vi.advanceTimersByTimeAsync(300);
      const before = fake.posts.length;
      expect((await latestBlock()).number).toBe(n);
      const statuses = await Promise.all(ids.map((id) => currentUpgradeStatus(id)));
      expect(statuses[0]?.state).toBe(UPGRADE_STATES.Waiting);
      expect((await listStandardUpgrades({ allHistory: true })).upgrades).toHaveLength(17);
      expect(fake.posts.length).toBe(before);
      expect(statusCalls(fake, n)).toHaveLength(2 * ids.length);
    }
    expect(held).toBe(true);
    expect(engine.status().ticks).toBe(2);
    release();
    await until(() => engine.status().ticks >= 4);
    await engine.settled();
    // Governance then ran for the newest head waiting (HEAD+3 took HEAD+2's turn).
    expect((await governance()).latestBlock.number).toBe((HEAD + 3n).toString());
    expect(engine.status()).toMatchObject({
      ticks: 4,
      lastTick: { block: (HEAD + 3n).toString(), failedSteps: [] },
    });
  });

  it("carries executed and expired ids forward once a read at a final block confirmed them", async () => {
    const { fake, ids } = liveChain();
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    expect(statusCalls(fake, HEAD)).toHaveLength(2 * ids.length);

    // 100 blocks later the first tick's block is final: the terminal ids are read once at the
    // boundary (one Multicall3 call), and only the live upgrade at the head.
    const later = HEAD + 100n;
    const boundary = HEAD + 20n;
    await advanceChain(engine, fake, later, boundary, 2);
    expect(statusCalls(fake, boundary)).toHaveLength(2 * (ids.length - 1));
    expect(fake.stateAggregates(numberToHex(boundary))).toHaveLength(1);
    expect(statusCalls(fake, later).map((c) => [c.functionName, c.args[0]])).toEqual([
      ["upgradeState", ACTIVE_ID],
      ["upgradeStatus", ACTIVE_ID],
    ]);
    const before = fake.posts.length;
    const statuses = await Promise.all(ids.map((id) => currentUpgradeStatus(id)));
    expect(statuses.slice(1).every((s) => s.state === UPGRADE_STATES.Done)).toBe(true);
    expect(fake.posts.length).toBe(before);

    // From then on they are carried forward: never read again.
    const next = later + 1n;
    await advanceChain(engine, fake, next, boundary, 3);
    expect(statusCalls(fake, next)).toHaveLength(2);
    expect(statusCalls(fake, boundary)).toHaveLength(2 * (ids.length - 1));
  });

  it("never carries forward a terminal state read at a head that was reorged away", async () => {
    const { fake } = liveChain();
    // At the first head the upgrade reads as executed...
    fake.upgrades.set(ACTIVE_ID.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [CREATED, CREATED + 100, false, false, true],
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.Done);

    // ...but that block was orphaned: on the canonical chain it never was.
    fake.upgrades.set(ACTIVE_ID.toLowerCase(), {
      state: UPGRADE_STATES.Waiting,
      status: [CREATED, 0, false, false, false],
    });
    const later = HEAD + 100n;
    await advanceChain(engine, fake, later, HEAD + 20n, 2);
    // Checked at the boundary, found not executed, and read at the head instead.
    expect(statusCalls(fake, HEAD + 20n).some((c) => c.args[0] === ACTIVE_ID)).toBe(true);
    expect(statusCalls(fake, later).map((c) => c.args[0])).toEqual([ACTIVE_ID, ACTIVE_ID]);
    expect((await currentUpgradeStatus(ACTIVE_ID)).state).toBe(UPGRADE_STATES.Waiting);
  });

  it("reads executed and expired ids at the head on a node that keeps no state at the boundary", async () => {
    // A full node: no state more than 64 blocks below its head (Geth keeps 128, less while
    // finality lags). The boundary, ~100 blocks deep, is out of its reach.
    const missing = new FakeRpcError(
      -32000,
      "missing trie node 0123 (path ) state is not available"
    );
    const head = () => fake.chain.options.head?.number ?? HEAD;
    let refused = 0;
    const { fake, ids } = liveChain({
      stateAt: (block) => {
        if (block === "latest" || BigInt(block) >= head() - 64n) return undefined;
        refused++;
        return missing;
      },
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);

    // 100 blocks later the first tick's block is final, but the node has no state there: the
    // terminal ids are read at the head with the others, and the tick does not fail.
    const later = HEAD + 100n;
    await advanceChain(engine, fake, later, HEAD + 20n, 2);
    // One aggregate3 at the boundary, refused.
    expect(refused).toBe(1);
    expect(engine.status().lastTick).toMatchObject({
      block: later.toString(),
      failedSteps: [],
    });
    expect(statusCalls(fake, later)).toHaveLength(2 * ids.length);
    const before = fake.posts.length;
    const statuses = await Promise.all(ids.map((id) => currentUpgradeStatus(id)));
    expect(statuses[0]?.state).toBe(UPGRADE_STATES.Waiting);
    expect(statuses.slice(1).every((s) => s.state === UPGRADE_STATES.Done)).toBe(true);
    expect(fake.posts.length).toBe(before);

    // The boundary is not asked again for 32 blocks: each head reads every id, in one call.
    await advanceChain(engine, fake, later + 1n, HEAD + 21n, 3);
    expect(refused).toBe(1);
    expect(statusCalls(fake, later + 1n)).toHaveLength(2 * ids.length);
    expect(fake.stateAggregates(numberToHex(later + 1n))).toHaveLength(1);
    expect(engine.status().lastTick?.failedSteps).toEqual([]);

    // 32 blocks on, the boundary is within reach again: confirmed there, carried forward after.
    const reach = later + 32n;
    await advanceChain(engine, fake, reach, reach - 64n, 4);
    expect(refused).toBe(1);
    expect(statusCalls(fake, reach - 64n)).toHaveLength(2 * (ids.length - 1));
    expect(statusCalls(fake, reach)).toHaveLength(2);
    await advanceChain(engine, fake, reach + 1n, reach - 63n, 5);
    expect(statusCalls(fake, reach + 1n)).toHaveLength(2);
    expect(engine.status().lastTick?.failedSteps).toEqual([]);
  });

  it("verifies the signature sets pages viewed at each new head: the request after the block asks nothing upstream", async () => {
    // Two of the three Security Council members signed the active upgrade's approval in Safe.
    const signatures = new Set<string>();
    const { fake } = liveChain({ signatures });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    const safe = await safeService(fake, signatures);
    for (const member of SC_MEMBERS.slice(0, 2)) safe.sign(member);
    // A page shows the set.
    safe.show();
    const viewed = await settle(safe.view());
    expect(viewed.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(safe.requests).toHaveLength(SC_MEMBERS.length);

    // The next block: the tick verifies the set at it once the head is served.
    vi.setSystemTime(NOW + 12_500);
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    await until(() => engine.status().ticks >= 2);
    await engine.settled();
    expect(engine.status().lastTick).toMatchObject({
      block: (HEAD + 1n).toString(),
      failedSteps: [],
    });
    expect(signatureSetsStatus()).toMatchObject({
      watched: 1,
      lastRun: { block: (HEAD + 1n).toString(), trigger: "head", sets: 1, verified: 1 },
    });
    // Asked at the new block itself, never at 'latest', and Safe was not asked again.
    const checks = fake.calls.filter((c) => c.functionName === "checkSignatures");
    expect(checks.filter((c) => c.block === numberToHex(HEAD + 1n))).not.toHaveLength(0);
    expect(checks.some((c) => c.block === "latest")).toBe(false);
    expect(safe.requests).toHaveLength(SC_MEMBERS.length);

    const posts = fake.posts.length;
    for (let round = 0; round < 50; round++) {
      expect((await latestBlock()).number).toBe(HEAD + 1n);
      const set = await safe.view();
      expect(set.thresholdCheck.status).toBe("met");
      expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    }
    expect(fake.posts.length).toBe(posts);
    expect(safe.requests).toHaveLength(SC_MEMBERS.length);
  });

  it("serves a new head only once the watched sets are verified at it: the first request at it is answered from memory", async () => {
    // The council's check at the next block answers 300 ms late (a slow upstream); everything
    // else at once.
    const next = numberToHex(HEAD + 1n);
    const signatures = new Set<string>();
    const { fake } = liveChain({
      signatures,
      gate: (call) =>
        call.block === next && call.functionName === "checkSignatures"
          ? new Promise((resolve) => setTimeout(resolve, 300))
          : undefined,
    });
    await backfilled();
    const engine = liveEngine();
    await firstTick(engine);
    const safe = await safeService(fake, signatures);
    for (const member of SC_MEMBERS.slice(0, 2)) safe.sign(member);
    safe.show();
    expect((await settle(safe.view())).thresholdCheck.status).toBe("met");
    /** The set as a request gets it now, if it is answered from memory: in this turn, no timer. */
    const fromMemory = async () => {
      const posts = fake.posts.length;
      let answered: Awaited<ReturnType<typeof safe.view>> | null = null;
      void safe.view().then((set) => {
        answered = set;
      });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(fake.posts.length).toBe(posts);
      return answered as Awaited<ReturnType<typeof safe.view>> | null;
    };

    // The next block reaches the node; the engine sees it at its next poll.
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    await until(() => engine.status().head?.number === (HEAD + 1n).toString(), 15_000);
    const observedAt = Date.parse(engine.status().head?.observedAt ?? "");
    // Until the set is verified at the new head, requests read the previous one, from memory.
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.status().head?.servedAt).toBeNull();
    expect((await latestBlock()).number).toBe(HEAD);
    expect(await fromMemory()).toMatchObject({ verifiedAtBlock: HEAD.toString() });

    // The moment the new head is served, its set is already verified at it.
    await until(() => engine.status().head?.servedAt != null, 2_500);
    const servedAt = Date.parse(engine.status().head?.servedAt ?? "");
    expect(servedAt - observedAt).toBeGreaterThanOrEqual(300);
    expect(servedAt - observedAt).toBeLessThan(2_000);
    expect((await latestBlock()).number).toBe(HEAD + 1n);
    expect(await fromMemory()).toMatchObject({
      verifiedAtBlock: (HEAD + 1n).toString(),
      thresholdCheck: { status: "met" },
    });
    expect(safe.requests).toHaveLength(SC_MEMBERS.length);
  });

  it("starts no more sets once use ended during a precompute: only those already under way finish", async () => {
    // Every on-chain approval read (signedMessages) at the next block waits until released.
    const next = numberToHex(HEAD + 1n);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signatures = new Set<string>();
    const { fake } = liveChain({
      signatures,
      gate: (call) =>
        call.block === next && call.functionName === "signedMessages" ? held : undefined,
    });
    await backfilled();
    // In use through a tab's beats alone (no page load's grace): its leave ends the use.
    const engine = liveEngine();
    showOnScreen([]);
    engine.resume();
    await until(() => engine.status().ticks >= 1);
    await engine.settled();
    const safe = await safeService(fake, signatures);
    const gov = await governance();
    // Two sets more on screen than the precompute verifies at a time, nobody signed in Safe:
    // each set reads every member's on-chain approval.
    const sets = Array.from({ length: PRECOMPUTE_CONCURRENCY + 2 }, (_, i) => ({
      ...safe.params,
      typedData: buildTypedData("ApproveUpgradeSecurityCouncil", gov.securityCouncil.domain, {
        id: pad(numberToHex(0x5e7 + i), { size: 32 }) as Hex,
      }),
    }));
    showOnScreen(sets);
    for (const set of sets) await settle(verifySignatureSet(set));
    const approvalsAt = () =>
      fake.calls.filter((c) => c.functionName === "signedMessages" && c.block === next).length;

    // The next block: the first sets' reads are out (and held) when the tab leaves.
    fake.chain.options.head = {
      number: HEAD + 1n,
      hash: blockHash(HEAD + 1n),
      timestamp: HEAD_TIME + 12n,
    };
    const perSet = gov.securityCouncil.members.length;
    await until(() => approvalsAt() === PRECOMPUTE_CONCURRENCY * perSet, 15_000);
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(approvalsAt()).toBe(PRECOMPUTE_CONCURRENCY * perSet);
    engine.stop();
  });

  it("the server's engine verifies a set on screen again at the served head when a member Safe's listing changes", async () => {
    const signatures = new Set<string>();
    const { fake } = liveChain({ signatures });
    await backfilled();
    noteRequest(request("/app/proposals"));
    await until(() => syncEngineStatus().ticks >= 1);
    const safe = await safeService(fake, signatures);
    for (const member of SC_MEMBERS.slice(0, 2)) safe.sign(member);
    safe.show();
    expect((await settle(safe.view())).members[2]?.status).toBe("missing");
    // The listings the page read were new to the store: the set they were read for already has
    // its result at this head.
    await until(() => signatureSetsStatus().lastRun?.trigger === "safe");
    expect(signatureSetsStatus().lastRun).toMatchObject({ verified: 0, reused: 1 });

    // The third member signs, and its listing is read again (as the sweep does before a listing
    // turns 60 s old) with a new version: the set is verified again at the head being served,
    // from the listings the store holds.
    await vi.advanceTimersByTimeAsync(20_000);
    safe.sign(SC_MEMBERS[2] as Hex);
    const requested = safe.requests.length;
    invalidate(`safe:list:${(SC_MEMBERS[2] as Hex).toLowerCase()}`);
    await settle(listSafeMessages(SC_MEMBERS[2] as Hex));
    await until(() => signatureSetsStatus().lastRun?.verified === 1);
    expect(signatureSetsStatus().lastRun).toMatchObject({
      trigger: "safe",
      block: HEAD.toString(),
      sets: 1,
      verified: 1,
      failed: 0,
    });
    expect(safe.requests.length).toBe(requested + 1);

    const posts = fake.posts.length;
    const requests = safe.requests.length;
    const set = await safe.view();
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "valid"]);
    expect(set.thresholdCheck.status).toBe("met");
    expect(fake.posts.length).toBe(posts);
    expect(safe.requests.length).toBe(requests);
  });

  it("drops a tick in flight when the settings change: nothing it read is stored", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const { fake } = liveChain({
      gate: (call) => {
        if (call.to !== L1.upgradeHandler || call.functionName !== "securityCouncil") return;
        holding = true;
        return held;
      },
    });
    await backfilled();
    const engine = liveEngine();
    touch(engine);
    await until(() => holding);
    // The settings change (as updateSettings does) while governance is being read.
    clearCache();
    resetRpcClients();
    release();
    await until(() => fake.calls.filter((c) => c.functionName === "securityCouncil").length > 0);
    await vi.advanceTimersByTimeAsync(100);
    await engine.settled();
    expect(engine.status()).toMatchObject({ ticks: 0, lastTick: null });
    expect(remainingMs(GOVERNANCE_KEY)).toBeNull();
    expect(remainingMs("latest-block")).toBeNull();
  });

  it("stays off on a dev node: no head polls, nothing seeded", async () => {
    const { fake } = liveChain({ clientVersion: "anvil/v1.0.0" });
    const engine = liveEngine();
    touch(engine);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.status()).toMatchObject({ mode: "off", reason: "dev node", active: false });
    expect(fake.requests("eth_getBlockByNumber")).toHaveLength(0);
    expect(fake.requests("eth_call")).toHaveLength(0);
  });

  it("the server's engine: a page load starts it, /api/status reports it, a settings change replaces it", async () => {
    liveChain();
    await backfilled();
    // SYNC_MODE defaults to "window": nothing follows the chain before someone uses the app.
    expect(syncEngineStatus()).toMatchObject({ mode: "window", active: false, polls: 0 });
    expect(safeStoreStatus()).toMatchObject({ sweeping: false, paused: "idle" });
    noteRequest(request("/app/proposals"));
    await until(() => syncEngineStatus().ticks >= 1);
    const status = syncEngineStatus();
    expect(status).toMatchObject({ active: true, head: { number: HEAD.toString() } });
    // JSON-safe as served.
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    // The page load also started the Safe store's sweep, which runs while the engine does: on
    // the public Safe service without a key it never reads in the background; with one, it has
    // nothing to do yet (no set on screen).
    expect(safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: process.env.SAFE_API_KEY ? null : "keyless-public-service",
    });

    // Settings change: the old engine retires at its next wake and the new one starts (the app is
    // still in use), reading through the new settings.
    clearCache();
    resetRpcClients();
    expect(syncEngineStatus()).toMatchObject({ active: false, polls: 0, ticks: 0 });
    await until(() => syncEngineStatus().ticks >= 1, 10_000);
    expect(syncEngineStatus()).toMatchObject({ active: true, ticks: 1 });
  });
});

describe("live engine, idle profile (SYNC_MODE=always, nobody viewing)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clearCache();
    resetRpcClients();
    resetUpstreamCost();
  });

  const governanceReads = (fake: ReturnType<typeof fakeL1>) =>
    fake.calls.filter((c) => c.functionName === "securityCouncil").length;

  /** Produces block `n` 500 ms into its slot and waits for the engine to tick there. */
  async function produce(engine: SyncEngine, fake: ReturnType<typeof fakeL1>, n: bigint) {
    const timestamp = HEAD_TIME + (n - HEAD) * 12n;
    await vi.advanceTimersByTimeAsync(Number(timestamp) * 1000 + 500 - Date.now());
    fake.chain.options.head = { number: n, hash: blockHash(n), timestamp };
    const ticks = engine.status().ticks;
    await until(() => engine.status().ticks > ticks, 5_000);
    await engine.settled();
  }

  it("reads governance at most every second block, and never lets it run out, a missed slot included", async () => {
    const { fake } = liveChain();
    await backfilled();
    const engine = liveEngine({ mode: "always" });
    engine.resume();
    await until(() => engine.status().ticks >= 1);
    await engine.settled();
    expect(engine.status().cost.mode).toBe("idle");
    expect(governanceReads(fake)).toBe(1);

    // Track whether governance is ever not served, sampling every 100 ms from here on.
    let gaps = 0;
    const sample = setInterval(() => {
      if (remainingMs(GOVERNANCE_KEY) === null) gaps++;
    }, 100);
    try {
      const readsAt: number[] = [];
      for (const n of [1n, 2n, 3n, 4n, 5n, 6n]) {
        await produce(engine, fake, HEAD + n);
        readsAt.push(governanceReads(fake));
        // Requests at the new head still get governance from memory.
        expect((await governance()).securityCouncil.members).toEqual(SC_MEMBERS);
      }
      // HEAD+1 skipped, HEAD+2 read, and so on: one read per two blocks.
      expect(readsAt).toEqual([1, 2, 2, 3, 3, 4]);
      // The upgrade states are still read at every block.
      for (const n of [1n, 2n, 3n, 4n, 5n, 6n])
        expect(statusCalls(fake, HEAD + n).length).toBeGreaterThan(0);

      // HEAD+7 (a skip), then two slots without a block: the value is read again before it would
      // run out, at the head served then.
      await produce(engine, fake, HEAD + 7n);
      expect(governanceReads(fake)).toBe(4);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(governanceReads(fake)).toBe(5);
      expect(gaps).toBe(0);
      expect((await governance()).latestBlock.number).toBe((HEAD + 7n).toString());
      // Still no block a minute later (a stalled chain): read again before each read runs out,
      // about every 27 s, never more often.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(governanceReads(fake)).toBe(7);
      expect(gaps).toBe(0);
      expect((await governance()).latestBlock.number).toBe((HEAD + 7n).toString());
    } finally {
      clearInterval(sample);
    }
    // While viewing: every block (and the keep-alive stops once a tick has read it).
    touch(engine);
    await produce(engine, fake, HEAD + 16n);
    const before = governanceReads(fake);
    await produce(engine, fake, HEAD + 17n);
    await produce(engine, fake, HEAD + 18n);
    expect(governanceReads(fake)).toBe(before + 2);
    expect(engine.status().cost.mode).toBe("viewing");
    engine.stop();
  });

  it("verifies only the signature sets on screen at each new head: none while nobody uses the app", async () => {
    const signatures = new Set<string>();
    const { fake } = liveChain({ signatures });
    await backfilled();
    const engine = liveEngine({ mode: "always" });
    engine.resume();
    await until(() => engine.status().ticks >= 1);
    await engine.settled();
    const safe = await safeService(fake, signatures);
    for (const member of SC_MEMBERS.slice(0, 2)) safe.sign(member);
    const gov = await governance();
    const set = (id: Hex, open: boolean): SignatureSetParams => ({
      action: "ApproveUpgradeSecurityCouncil",
      signerGroup: "securityCouncil",
      typedData: buildTypedData("ApproveUpgradeSecurityCouncil", gov.securityCouncil.domain, {
        id,
      }),
      members: [...gov.securityCouncil.members],
      threshold: gov.securityCouncil.thresholds.approveUpgrade,
      check: { kind: "multisig", contract: gov.securityCouncil.address },
      open,
    });
    // The active upgrade's approval is open; another (executed) upgrade's is done. Pages showed
    // both, then their tab was closed.
    const open = set(ACTIVE_ID, true);
    const done = set(`0x${"de".repeat(32)}`, false);
    showOnScreen([open, done]);
    await settle(verifySignatureSet(open));
    await settle(verifySignatureSet(done));
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    expect(signatureSetsStatus()).toMatchObject({ watched: 2, onScreen: 0 });

    // Nobody uses the app: neither is verified again, open or not.
    await produce(engine, fake, HEAD + 1n);
    expect(signatureSetsStatus().lastRun).toMatchObject({
      block: (HEAD + 1n).toString(),
      trigger: "head",
      profile: "idle",
      sets: 0,
    });
    // A tab shows both: both.
    showOnScreen([open, done]);
    await produce(engine, fake, HEAD + 2n);
    expect(signatureSetsStatus().lastRun).toMatchObject({
      block: (HEAD + 2n).toString(),
      profile: "viewing",
      sets: 2,
      verified: 2,
    });
    engine.stop();
  });

  it("counts every JSON-RPC request and Safe request sent upstream, in /api/status's engine report", async () => {
    const signatures = new Set<string>();
    const { fake } = liveChain({ signatures });
    await backfilled();
    const engine = liveEngine({ mode: "always" });
    engine.resume();
    await until(() => engine.status().ticks >= 1);
    await engine.settled();
    const safe = await safeService(fake, signatures);
    safe.sign(SC_MEMBERS[0] as Hex);
    await settle(safe.view());
    await produce(engine, fake, HEAD + 1n);
    const entries = fake.posts.reduce((n, post) => n + post.calls.length, 0);
    const cost = engine.status().cost;
    expect(entries).toBeGreaterThan(10);
    expect(cost).toMatchObject({
      mode: "idle",
      l1RpcPerHour: entries,
      l2RpcPerHour: 0,
      rpcPerHour: entries,
      safePerHour: safe.requests.length,
    });
    expect(safe.requests.length).toBe(SC_MEMBERS.length);
    expect(syncEngineStatus().cost.rpcPerHour).toBe(0 + entries);
    engine.stop();
  });

  it("the server's engine in SYNC_MODE=window: the start follows nothing; a page load does", async () => {
    const { fake } = liveChain();
    await backfilled();
    const before = fake.posts.length;
    startSync();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncEngineStatus()).toMatchObject({ mode: "window", active: false, polls: 0 });
    expect(fake.posts.length).toBe(before);
    noteRequest(request("/app/proposals"));
    await until(() => syncEngineStatus().ticks >= 1);
    expect(syncEngineStatus()).toMatchObject({ active: true, cost: { mode: "viewing" } });
  });
});
