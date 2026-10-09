import { type Hex, numberToHex, pad, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainLog, PUH_TOPICS, puhHistory } from "../support/fake-chain";
import { G_MEMBERS, L1, SC_MEMBERS, type UpgradeOnChain, fakeL1 } from "../support/fake-l1";

// The first visitor of a freshly started server opens an upgrade page while the boot warm-up reads
// governance, the log index and (with a key) the member Safes at low priority: the page's listings
// are read while it waits for the index, ahead of the warm-up's, so it is ready about when the
// index is.

// With a key: 220 ms between Safe requests; background reads of the public service are allowed.
vi.stubEnv("SAFE_API_KEY", "test-key");
// Nothing here is about ZKsync Era: the upgrade's L2 proposal is "none".
vi.mock("@/.server/flows/l2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/flows/l2")>()),
  findL2ProposalForUpgrade: async () => null,
}));

const { clearCache } = await import("@/.server/cache");
const { puhIndex } = await import("@/.server/chain/puh-index");
const { loadStandardUpgrade } = await import("@/.server/flows/standard");
const { prewarm } = await import("@/.server/prewarm");
const { resetRpcClients } = await import("@/.server/rpc");
const { resetSafeClient } = await import("@/.server/safe-api");
const { encodeUpgradeProposal, upgradeProposalId } = await import("@/common/proposal");
const { UPGRADE_STATES } = await import("@/common/upgrade-states");

const NOW = 1_800_000_000_000;
const HEAD = 26_129_107n;
const FINAL = HEAD - 80n;
// The backfill's one full-range eth_getLogs answers after this long.
const BACKFILL_MS = 2_500;
// Each Safe answer takes this long.
const SAFE_MS = 300;

const ACTIVE = {
  calls: [{ target: `0x${"0a".repeat(20)}` as Hex, value: "0", data: "0x" as Hex }],
  executor: zeroAddress,
  salt: pad(numberToHex(0xb007), { size: 32 }) as Hex,
};
const ACTIVE_ID = upgradeProposalId(ACTIVE);

/** An eth_getLogs over more than a few blocks: the index backfill's. */
function isBackfill(call: { method: string; params: unknown[] }) {
  if (call.method !== "eth_getLogs") return false;
  const { fromBlock, toBlock } = call.params[0] as { fromBlock?: string; toBlock?: string };
  return !!fromBlock && !!toBlock && BigInt(toBlock) - BigInt(fromBlock) > 1_000n;
}

type SafeRequest = { safe: string; at: number; answeredAt: number | null; concurrent: number };

function boot() {
  const history = puhHistory(L1.deployBlock, FINAL - 1_000n);
  const startedAt = FINAL - 500n;
  const started: ChainLog = {
    blockNumber: startedAt,
    logIndex: 0,
    topics: [PUH_TOPICS.UpgradeStarted, ACTIVE_ID],
    data: encodeUpgradeProposal(ACTIVE),
  };
  const upgrades = new Map<string, UpgradeOnChain>([
    [
      ACTIVE_ID.toLowerCase(),
      {
        state: UPGRADE_STATES.Waiting,
        status: [Number(1_700_000_000n + startedAt * 12n), 0, false, false, false],
      },
    ],
  ]);
  const fake = fakeL1({
    head: { number: HEAD, timestamp: BigInt(Math.floor(NOW / 1000)) - 1n },
    finalized: FINAL,
    logs: [...history.logs, started],
    upgrades,
    // Only the backfill's range is slow (the canary's one-block query is not).
    delayMs: (post) => (post.calls.some(isBackfill) ? BACKFILL_MS : 0),
  });
  const safe = { requests: [] as SafeRequest[], inFlight: 0 };
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.safe.global/")) {
      const request: SafeRequest = {
        safe: (/\/safes\/(0x[0-9a-fA-F]{40})\//.exec(url)?.[1] ?? "").toLowerCase(),
        at: Date.now(),
        answeredAt: null,
        concurrent: ++safe.inFlight,
      };
      safe.requests.push(request);
      await new Promise((resolve) => setTimeout(resolve, SAFE_MS));
      safe.inFlight--;
      request.answeredAt = Date.now();
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (!url.startsWith("http://127.0.0.1:9")) return new Response("unavailable", { status: 503 });
    return fake.fetch(input, init);
  });
  return { fake, safe };
}

/** Runs the fake clock until `promise` settles; returns when it did (ms after NOW). */
async function settledAt<T>(promise: Promise<T>, maxMs = 20_000): Promise<number> {
  let at: number | null = null;
  void promise.then(
    () => {
      at ??= Date.now() - NOW;
    },
    () => {
      at ??= Date.now() - NOW;
    }
  );
  for (let waited = 0; at === null; waited += 10) {
    if (waited > maxMs) throw new Error("timed out waiting");
    await vi.advanceTimersByTimeAsync(10);
  }
  return at;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the first visitor during the boot warm-up", () => {
  it("gets an upgrade's signatures about when the log index is ready, not the index wait plus the Safe floor", async () => {
    const { safe } = boot();
    const members = [...SC_MEMBERS, ...G_MEMBERS].map((m) => m.toLowerCase());
    // The server starts: the warm-up runs (the index backfill takes 2.5 s)...
    const warm = prewarm("boot");
    // ...and the first visitor opens the upgrade page right away.
    const loading = loadStandardUpgrade(ACTIVE_ID);
    const overview = await settledAt(loading);
    const { sets } = await loading;
    const signatures = await settledAt(sets);
    const verified = await sets;
    const index = puhIndex().status();
    expect(index.state).toBe("ready");

    // The page waits for the backfill, but its Safe listings were read meanwhile.
    expect(overview).toBeGreaterThanOrEqual(BACKFILL_MS);
    expect(signatures - overview).toBeLessThan(200);
    expect(signatures).toBeLessThan(BACKFILL_MS + 300);
    for (const member of members) {
      const reads = safe.requests.filter((r) => r.safe === member);
      // Each member Safe's listing was read once, before the index was ready.
      expect(reads).toHaveLength(1);
      expect(((reads[0] as SafeRequest).answeredAt as number) - NOW).toBeLessThanOrEqual(
        BACKFILL_MS
      );
    }
    expect(Math.max(...safe.requests.map((r) => r.concurrent))).toBeLessThanOrEqual(4);
    expect(verified.map((s) => s.set.members.map((m) => m.status))).toEqual([
      ["missing", "missing", "missing"],
      ["missing", "missing", "missing"],
      ["missing", "missing", "missing"],
    ]);
    await settledAt(warm);
  });

  it("reads the page's own listings while it waits for the index, also without the warm-up", async () => {
    // PREWARM=0, or a warm-up that has not reached the Safes yet: the page is alone.
    const { safe } = boot();
    const loading = loadStandardUpgrade(ACTIVE_ID);
    const overview = await settledAt(loading);
    const signatures = await settledAt((await loading).sets);
    expect(overview).toBeGreaterThanOrEqual(BACKFILL_MS);
    // 6 listings at 220 ms spacing were done long before the index.
    expect(signatures - overview).toBeLessThan(200);
    expect(safe.requests).toHaveLength(6);
    expect(Math.max(...safe.requests.map((r) => r.at - NOW))).toBeLessThan(1_500);
  });

  it("reads the page's member Safes ahead of the warm-up's queued background reads", async () => {
    const { safe } = boot();
    const members = [...SC_MEMBERS, ...G_MEMBERS].map((m) => m.toLowerCase());
    const { warmSafeListing } = await import("@/.server/safe/store");
    // Background reads of 17 other Safes are queued first, then the page asks for its members.
    const others = Array.from(
      { length: 17 },
      (_, i) => `0x${(0xf00 + i).toString(16).padStart(40, "0")}` as Hex
    );
    const background = others.map((s) => warmSafeListing(s).catch(() => null));
    await vi.advanceTimersByTimeAsync(1);
    const loading = loadStandardUpgrade(ACTIVE_ID);
    await settledAt(loading);
    await settledAt((await loading).sets);
    // The page's reads went out ahead of every background read still queued.
    const order = safe.requests.map((r) => (members.includes(r.safe) ? "page" : "background"));
    const first = order.indexOf("page");
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2);
    expect(order.slice(first, first + members.length)).toEqual(members.map(() => "page"));
    expect(order.filter((kind) => kind === "page")).toHaveLength(members.length);
    // Background reads never held more than two of Safe's four slots.
    const backgroundAt = (r: SafeRequest) => !members.includes(r.safe);
    for (const request of safe.requests.filter(backgroundAt)) {
      const overlapping = safe.requests.filter(
        (other) =>
          backgroundAt(other) &&
          other.at <= request.at &&
          (other.answeredAt ?? Number.POSITIVE_INFINITY) > request.at
      );
      expect(overlapping.length).toBeLessThanOrEqual(2);
    }
    expect(Math.max(...safe.requests.map((r) => r.concurrent))).toBeLessThanOrEqual(4);
    await settledAt(Promise.all(background));
  });
});
