import type { SafeMessage } from "@/.server/safe-api";
import type { SafeWatchDriver } from "@/.server/safe/store";
import { type Address, type Hex, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Safe snapshot store: listings served while at most 60 s old (from the answer's arrival),
// older ones read again for the request ahead of background work, and the watcher that asks Safe
// about the member Safes the screen depends on (an open set's members not valid yet every minute,
// a list's sources every 5 minutes), one small change check per Safe, one Safe at a time, within
// its hourly budget and the quota Safe reports, slower without a key, never during a cooldown and
// never while nobody uses the app; the viewer's own Safe read after they sign; "Fetch signatures";
// and the copies a page may use. Driven by a fake Safe Transaction Service and fake timers.

const net = vi.hoisted(() => ({
  chainId: 1,
  safeTxServiceUrl: "https://api.safe.global/tx-service/eth" as string | null,
  isDevNode: false,
}));
vi.mock("@/.server/rpc", () => ({ network: async () => ({ ...net }) }));

type Store = typeof import("@/.server/safe/store");
type Api = typeof import("@/.server/safe-api");
type Cache = typeof import("@/.server/cache");
let store: Store;
let api: Api;
let cache: Cache;

const NOW = Date.parse("2026-10-06T08:00:00Z");
const address = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const messageHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
/** Safe's timestamp format (microseconds, UTC). */
const stamp = (ms: number) => new Date(ms).toISOString().replace("Z", "123Z");

const A = address(0xa);
const B = address(0xb);
const W = [1, 2, 3, 4, 5].map((n) => address(0x100 + n)) as [
  Address,
  Address,
  Address,
  Address,
  Address,
];

type Sent = { at: number; safe: string | null; kind: "listing" | "newest" | "message" };

/** A Safe Transaction Service that orders, pages and rate limits like the real one. */
function fakeSafe() {
  const service = {
    lists: new Map<string, SafeMessage[]>(),
    sent: [] as Sent[],
    latencyMs: 0,
    /** Answer 429 with this Retry-After (seconds) while set. */
    limited: null as number | null,
    /** With `limited`: the 429 is for the monthly quota (none remaining). */
    exhausted: false,
    /** Safes (lowercase) whose every request answers HTTP 500. */
    failing: new Set<string>(),
    headers: {} as Record<string, string>,
    add(safe: Address, n: number) {
      const list = service.lists.get(safe.toLowerCase()) ?? [];
      list.push({
        created: stamp(Date.now()),
        modified: stamp(Date.now()),
        safe,
        messageHash: messageHash(n),
        message: { n },
        confirmations: [{ owner: safe, signature: "0x01", signatureType: "EOA" }],
        preparedSignature: "0x01",
      });
      service.lists.set(safe.toLowerCase(), list);
      // Messages created in the same microsecond would tie.
      vi.advanceTimersByTime(1);
    },
    /** A new owner confirmation: Safe sets the message's `modified` to its time. */
    confirm(safe: Address, n: number) {
      const message = service.lists
        .get(safe.toLowerCase())
        ?.find((m) => m.messageHash === messageHash(n));
      if (!message) throw new Error("no such message");
      message.confirmations.push({ owner: A, signature: "0x02", signatureType: "EOA" });
      message.preparedSignature = "0x0102";
      message.modified = stamp(Date.now());
    },
    count(kind?: Sent["kind"], safe?: Address) {
      return service.sent.filter(
        (s) => (!kind || s.kind === kind) && (!safe || s.safe === safe.toLowerCase())
      ).length;
    },
  };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...service.headers },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const list = /\/api\/v1\/safes\/(0x[0-9a-fA-F]{40})\/messages\/$/.exec(url.pathname);
      const one = /\/api\/v1\/messages\/(0x[0-9a-fA-F]{64})\/$/.exec(url.pathname);
      const ordering = url.searchParams.get("ordering");
      service.sent.push({
        at: Date.now(),
        safe: list?.[1]?.toLowerCase() ?? null,
        kind: !list ? "message" : ordering === "-modified" ? "newest" : "listing",
      });
      if (service.latencyMs > 0)
        await new Promise((resolve) => setTimeout(resolve, service.latencyMs));
      if (service.limited !== null)
        return service.exhausted
          ? new Response("Monthly quota exceeded", {
              status: 429,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(service.limited),
              },
            })
          : new Response("Rate limited", {
              status: 429,
              headers: { "retry-after": String(service.limited), "x-ratelimit-remaining": "50" },
            });
      if (list && service.failing.has((list[1] as string).toLowerCase()))
        return new Response("Server error", { status: 500 });
      if (list) {
        const all = [...(service.lists.get((list[1] as string).toLowerCase()) ?? [])].sort(
          (a, b) =>
            ordering === "-modified"
              ? b.modified.localeCompare(a.modified)
              : b.created.localeCompare(a.created)
        );
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        // Fresh objects, as a real response is parsed anew.
        return json({ count: all.length, results: all.slice(offset, offset + limit) });
      }
      const hit = [...service.lists.values()]
        .flat()
        .find((m) => m.messageHash.toLowerCase() === one?.[1]?.toLowerCase());
      return hit ? json(hit) : new Response(null, { status: 404 });
    })
  );
  return service;
}

async function load({
  key = "test-key",
  budget,
  keylessMs,
}: { key?: string; budget?: number; keylessMs?: number } = {}) {
  vi.resetModules();
  // An empty value also keeps dotenv from setting one.
  vi.stubEnv("SAFE_API_KEY", key);
  if (budget !== undefined) vi.stubEnv("SYNC_SAFE_HOURLY_BUDGET", String(budget));
  if (keylessMs !== undefined) vi.stubEnv("SYNC_SAFE_WATCH_KEYLESS_MS", String(keylessMs));
  cache = await import("@/.server/cache");
  api = await import("@/.server/safe-api");
  store = await import("@/.server/safe/store");
}

/**
 * The engine's side of the watcher: in use while `activity.on`; `screen.set` are members of open
 * sets on screen not valid yet, `screen.list` the Safes lists on screen collect from.
 */
function watcher(
  screen: { set?: readonly Address[]; list?: readonly Address[] },
  activity = { on: true }
): SafeWatchDriver {
  return {
    active: () => activity.on,
    watched: () => [
      ...(screen.set ?? []).map((safe) => ({ safe, kind: "set" as const })),
      ...(screen.list ?? []).map((safe) => ({ safe, kind: "list" as const })),
    ],
  };
}

/** `n` member Safes. */
const safes = (n: number, base = 0x300) => Array.from({ length: n }, (_, i) => address(base + i));

// Safe's public service with a key, early in its period (as measured: 50,000 a month).
const QUOTA_HEADERS = {
  "x-ratelimit-limit": "50000",
  "x-ratelimit-remaining": "49113",
  "x-ratelimit-reset": "2577504",
};

/** Lets `ms` pass, then returns the promise's value. */
async function within<T>(ms: number, promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

const background = (service: ReturnType<typeof fakeSafe>, since = 0) =>
  service.sent.filter((s) => s.at >= since);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  net.safeTxServiceUrl = "https://api.safe.global/tx-service/eth";
  net.isDevNode = false;
});

afterEach(() => {
  store?.stopSafeWatch();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("listings on the request path", () => {
  it("serves a listing up to 60 s old without asking Safe, and reads it again at 61 s", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const first = await store.listSafeMessages(A);
    expect(first.messages.map((m) => m.messageHash)).toEqual([messageHash(1)]);
    expect(first.fetchedAt).toBe(Date.now());
    expect(safe.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await store.listSafeMessages(A)).toBe(first);
    expect(safe.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    const second = await store.listSafeMessages(A);
    expect(safe.sent).toHaveLength(2);
    expect(second.fetchedAt).toBe(Date.now());
    // Same content: same version.
    expect(second.version).toBe(first.version);
  });

  it("answers from the listing it holds without asking Safe (verdict precomputes), and only while it is at most 60 s old", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    expect(store.peekSafeMessage(A, messageHash(1))).toBeNull();
    expect(store.freshListingVersion(A)).toBeNull();
    const listing = await store.listSafeMessages(A);
    expect(store.freshListingVersion(A)).toBe(listing.version);
    expect(store.peekSafeMessage(A, messageHash(1))).toMatchObject({
      message: { messageHash: messageHash(1) },
      version: listing.version,
    });
    // A complete listing without the message answers "none".
    expect(store.peekSafeMessage(A, messageHash(2))).toEqual({
      message: null,
      version: listing.version,
      fetchedAt: listing.fetchedAt,
    });
    expect(await store.lookupSafeMessage(A, messageHash(1))).toMatchObject({
      version: listing.version,
      fetchedAt: listing.fetchedAt,
    });
    expect(safe.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(store.peekSafeMessage(A, messageHash(1))).toBeNull();
    expect(store.freshListingVersion(A)).toBeNull();
    // Peeking never reads.
    expect(safe.sent).toHaveLength(1);
  });

  it("hands a page the listing it holds whatever its age, with its arrival time, without asking Safe or keeping it fresh", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    expect(store.heldSafeListing(A)).toBeNull();
    expect(store.peekHeldSafeMessage(A, messageHash(1))).toBeNull();
    const listing = await store.listSafeMessages(A);
    // Ten minutes later: no longer served to a request, still held for a page's first answer.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.freshListingVersion(A)).toBeNull();
    expect(store.heldSafeListing(A)).toMatchObject({
      version: listing.version,
      fetchedAt: listing.fetchedAt,
    });
    expect(Date.now() - (store.heldSafeListing(A)?.fetchedAt ?? 0)).toBe(600_000);
    expect(store.peekHeldSafeMessage(A, messageHash(1))).toMatchObject({
      message: { messageHash: messageHash(1) },
      version: listing.version,
      fetchedAt: listing.fetchedAt,
    });
    expect(store.peekHeldSafeMessage(A, messageHash(2))).toEqual({
      message: null,
      version: listing.version,
      fetchedAt: listing.fetchedAt,
    });
    // Never a read; and with nothing on screen the watcher checks nothing.
    expect(safe.sent).toHaveLength(1);
    store.startSafeWatch(watcher({}));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus().watched).toMatchObject({ safes: 0, lists: 0 });
    store.stopSafeWatch();
    // A refresh drops it like any other listing.
    cache.invalidate("safe:");
    expect(store.heldSafeListing(A)).toBeNull();
  });

  it("cannot tell from a listing that stops before its last page: a lookup asks by hash, a peek says nothing", async () => {
    await load();
    const safe = fakeSafe();
    for (let n = 1; n <= 501; n++) safe.add(A, n);
    await within(5_000, store.listSafeMessages(A));
    expect(store.peekSafeMessage(A, messageHash(1))).toBeNull();
    const byHash = await within(1_000, store.lookupSafeMessage(A, messageHash(1)));
    expect(byHash).toMatchObject({
      message: { messageHash: messageHash(1) },
      version: null,
      fetchedAt: null,
    });
  });

  it("tells listeners when a listing is stored with a new version, not when it is read again unchanged", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const seen: string[] = [];
    const unsubscribe = store.onSafeListingChange((s) => seen.push(s));
    await store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([A.toLowerCase()]);
    await vi.advanceTimersByTimeAsync(61_000);
    await store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([A.toLowerCase()]);
    safe.add(A, 2);
    await vi.advanceTimersByTimeAsync(61_000);
    await store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([A.toLowerCase(), A.toLowerCase()]);
    unsubscribe();
    safe.add(A, 3);
    await vi.advanceTimersByTimeAsync(61_000);
    await store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(2);
  });

  it("counts a paged listing's age from its first page's answer", async () => {
    await load();
    const safe = fakeSafe();
    for (let n = 1; n <= 150; n++) safe.add(A, n);
    safe.latencyMs = 400;
    const start = Date.now();
    const listing = await within(5_000, store.listSafeMessages(A));
    expect(listing.messages).toHaveLength(150);
    expect(listing.complete).toBe(true);
    expect(safe.count("listing", A)).toBe(2);
    expect(listing.fetchedAt).toBe(start + 400);
  });

  it("shares one read among concurrent callers", async () => {
    await load();
    const safe = fakeSafe();
    safe.latencyMs = 300;
    const reads = [1, 2, 3].map(() => store.listSafeMessages(A));
    const [one, two, three] = await within(1_000, Promise.all(reads));
    expect(one).toBe(two);
    expect(two).toBe(three);
    expect(safe.sent).toHaveLength(1);
  });

  it("at 61 s reads only the stale Safes, ahead of the watcher's checks", async () => {
    await load(); // with a key: 220 ms between requests
    const safe = fakeSafe();
    for (const s of [A, B, ...W]) safe.add(s, 1);
    // A page asked for A, for an open set's member (W1), and 30 s later for B.
    await within(1_000, store.listSafeMessages(W[0]));
    await within(1_000, store.listSafeMessages(A));
    await vi.advanceTimersByTimeAsync(28_000);
    await within(1_000, store.listSafeMessages(B));
    await vi.advanceTimersByTimeAsync(61_000 - (Date.now() - NOW) + 1_500);

    // The watcher starts its first check (W1's copy is over a minute old) ...
    const since = Date.now();
    store.startSafeWatch(watcher({ set: W }));
    await vi.advanceTimersByTimeAsync(1);
    expect(background(safe, since)).toHaveLength(1);
    // ... and a page needs A (61 s old) and B (31 s old).
    const [a, b] = [store.listSafeMessages(A), store.listSafeMessages(B)];
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await a).fetchedAt).toBeGreaterThan(since);
    expect((await b).fetchedAt).toBeLessThan(since);
    // A went at once; B was not read; the watcher's next check waits its turn (one at a time).
    expect(background(safe, since).map((s) => [s.kind, s.safe])).toEqual([
      ["newest", W[0].toLowerCase()],
      ["listing", A.toLowerCase()],
    ]);
  });

  it("shares a background read a request needs, moving it ahead of the other background reads", async () => {
    await load();
    const safe = fakeSafe();
    for (const s of W) safe.add(s, 1);
    // The boot warm-up's reads, at low priority, one after another in the pacer.
    const warm = W.slice(0, 4).map((s) => store.warmSafeListing(s));
    await vi.advanceTimersByTimeAsync(1);
    const page = store.listSafeMessages(W[3]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await page).toBe(await warm[3]);
    expect(safe.sent.map((s) => s.safe)).toEqual(
      [W[0], W[3], W[1], W[2]].map((s) => s.toLowerCase())
    );
  });

  it("looks a message up by hash only when the listing is incomplete", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    expect(await store.findSafeMessage(A, messageHash(1))).toMatchObject({
      messageHash: messageHash(1),
    });
    // A complete listing without it: not there (no extra request).
    expect(await store.findSafeMessage(A, messageHash(2))).toBeNull();
    expect(safe.sent.map((s) => s.kind)).toEqual(["listing"]);
  });

  it("drops listings on refresh and on clearCache; a read in flight then is not kept", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    expect(api.refreshSafeData()).toBe(true);
    await within(1_000, store.listSafeMessages(A));
    expect(safe.sent).toHaveLength(2);

    // In flight while the cache is cleared (a dev-node refresh, a settings change): its caller
    // gets the answer, the store does not keep it.
    safe.latencyMs = 500;
    const pending = store.listSafeMessages(B);
    await vi.advanceTimersByTimeAsync(100);
    cache.clearCache();
    const late = await within(1_000, pending);
    expect(late.messages).toEqual([]);
    expect(store.safeListingVersion(B)).toBeNull();
    await within(2_000, store.listSafeMessages(B));
    expect(safe.count("listing", B)).toBe(2);
    // A was dropped too.
    await within(2_000, store.listSafeMessages(A));
    expect(safe.count("listing", A)).toBe(3);
  });

  it("discards a late answer from before a settings change, and what was held before it", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    safe.latencyMs = 500;
    const pending = store.listSafeMessages(B);
    const failed = expect(pending).rejects.toThrow("settings changed");
    await vi.advanceTimersByTimeAsync(100);
    api.resetSafeClient();
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    expect(store.safeListingVersion(B)).toBeNull();
    // A's listing came from the old settings: read again.
    expect(store.safeListingVersion(A)).toBeNull();
    await within(1_000, store.listSafeMessages(A));
    expect(safe.count("listing", A)).toBe(2);
  });
});

describe("the watcher", () => {
  /** A page read these Safes' listings (at request priority); returns when it had them all. */
  async function pageRead(service: ReturnType<typeof fakeSafe>, members: readonly Address[]) {
    for (const m of members) if (!service.lists.has(m.toLowerCase())) service.add(m, 1);
    let done = false;
    const read = Promise.all(members.map((m) => store.listSafeMessages(m))).finally(() => {
      done = true;
    });
    while (!done) await vi.advanceTimersByTimeAsync(50);
    await read;
    await vi.advanceTimersByTimeAsync(1);
    return Date.now();
  }

  it("C-2: an open set's 16 members not valid yet are each asked about every minute, one Safe at a time, with one small request (the listing only when it changed)", async () => {
    await load();
    const safe = fakeSafe();
    const members = safes(16);
    await pageRead(safe, members);
    const since = Date.now();
    store.startSafeWatch(watcher({ set: members }));
    await vi.advanceTimersByTimeAsync(3_600_000);
    const checks = background(safe, since);
    // Change checks only (nothing changed): no listing read again.
    expect(checks.every((s) => s.kind === "newest")).toBe(true);
    expect(safe.count("listing")).toBe(16);
    // At most 16 x 60 in the hour.
    expect(checks.length).toBeLessThanOrEqual(16 * 60);
    expect(checks.length).toBeGreaterThanOrEqual(16 * 57);
    // One Safe at a time: starts 60 s / 16 = 3.75 s apart.
    for (let i = 1; i < checks.length; i++)
      expect((checks[i] as Sent).at - (checks[i - 1] as Sent).at).toBeGreaterThanOrEqual(3_750);
    // Once spread (after the first round), each Safe is asked about every minute.
    for (const m of members) {
      const at = checks.filter((s) => s.safe === m.toLowerCase()).map((s) => s.at);
      const gaps = at.slice(2).map((t, i) => t - (at[i + 1] as number));
      for (const gap of gaps) expect(gap).toBeLessThanOrEqual(64_000);
    }
    // A page may use every copy without asking Safe: each was confirmed within its bound.
    for (const m of members) expect(store.pageSafeListing(m, "set")).not.toBeNull();
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: true,
      paused: null,
      watched: {
        safes: 16,
        lists: 0,
        keyless: false,
        cadenceMs: { set: 60_000, list: 300_000 },
        effectiveCadenceMs: { set: 60_000 },
      },
      budgetUsedThisHour: expect.any(Number),
    });
    expect(store.safeStoreStatus().budgetUsedThisHour).toBeLessThanOrEqual(16 * 60);
  });

  it("C-2: stretches the cadence when Safe reports little quota left, and never spends above the hourly budget", async () => {
    // The guard: T_eff = T x max(1, demand / (0.8 x allowance)), allowance = min(budget,
    // (remaining - 20 % of limit) / (hours to reset x 0.25)): planned at 80 % of what it may
    // use, the rest is room to catch up.
    await load();
    const now = Date.now();
    const base = { set: 60_000, list: 300_000 };
    const measured = { limit: 50_000, remaining: 37_783, resetAt: now + 678 * 3_600_000 };
    const t = store.watchCadence({ set: 16, list: 0 }, base, measured, now, 1_200);
    // (37,783 - 10,000) / (678 h x 0.25) = 163.9 an hour, 131.1 planned: 16 Safes about every
    // 7.3 minutes.
    expect(t.allowancePerHour).toBeCloseTo(163.9, 0);
    expect(t.set / 1000).toBeCloseTo((16 * 3_600) / (0.8 * 163.9), -1);
    // 8 Safes: 480 an hour wanted, 131.1 planned: every 3.7 minutes.
    expect(
      store.watchCadence({ set: 8, list: 0 }, base, measured, now, 1_200).set / 1000
    ).toBeCloseTo((8 * 3_600) / (0.8 * 163.9), -1);
    // Without quota headers, the budget alone: 16 at 60 s fit 80 % of 1,200; 25 do not (94 s).
    const none = { limit: null, remaining: null, resetAt: null };
    expect(store.watchCadence({ set: 16, list: 0 }, base, none, now, 1_200).set).toBe(60_000);
    expect(store.watchCadence({ set: 25, list: 0 }, base, none, now, 1_200).set).toBe(93_750);
    // Lists and sets share the allowance.
    const both = store.watchCadence({ set: 16, list: 17 }, base, none, now, 1_000);
    expect(both.set).toBeCloseTo((60_000 * (960 + 204)) / 800, 0);
    expect(both.list).toBeCloseTo((300_000 * (960 + 204)) / 800, 0);
    // Nothing left above the reserve, or no budget: none at all.
    const low = { limit: 50_000, remaining: 9_000, resetAt: now + 3_600_000 };
    expect(store.watchCadence({ set: 1, list: 0 }, base, low, now, 1_200).set).toBe(
      Number.POSITIVE_INFINITY
    );
    expect(store.watchCadence({ set: 1, list: 0 }, base, none, now, 0).set).toBe(
      Number.POSITIVE_INFINITY
    );

    // Live, with Safe's quota early in its period (49,113 of 50,000 left, ~29.8 days to reset):
    // 218.5 an hour allowed, 174.8 planned: 16 Safes about every 5.5 minutes.
    const safe = fakeSafe();
    safe.headers = QUOTA_HEADERS;
    const members = safes(16);
    await pageRead(safe, members);
    const since = Date.now();
    store.startSafeWatch(watcher({ set: members }));
    await vi.advanceTimersByTimeAsync(3_600_000);
    const effective = store.safeStoreStatus().watched?.effectiveCadenceMs.set as number;
    expect(effective / 1000).toBeGreaterThan(315);
    expect(effective / 1000).toBeLessThan(345);
    // The status says why: the allowance the quota leaves, under the budget.
    const allowance = store.safeStoreStatus().watched?.allowancePerHour as number;
    expect(allowance).toBeLessThan(1_200);
    expect(Math.abs(0.8 * allowance - (16 * 3_600_000) / effective)).toBeLessThanOrEqual(1);
    // Within the allowance; about the planned rate (the copies read together are checked again
    // spread over the first cadence, some of them early).
    const checks = background(safe, since).length;
    expect(checks).toBeLessThanOrEqual(allowance);
    expect(checks).toBeLessThanOrEqual(Math.ceil((16 * 3_600_000) / effective) + 16);

    // A budget of 4 an hour: 3 Safes each every 56 minutes (80 % of 4 an hour), never more than
    // 4 in an hour; a page still reads at once.
    store.stopSafeWatch();
    await load({ budget: 4 });
    const limited = fakeSafe();
    const start = await pageRead(limited, W.slice(0, 3));
    store.startSafeWatch(watcher({ set: W.slice(0, 3) }));
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(store.safeStoreStatus()).toMatchObject({
      watched: { effectiveCadenceMs: { set: 56.25 * 60_000 } },
      budgetPerHour: 4,
    });
    const sent = background(limited, start).map((s) => s.at);
    expect(sent.length).toBeGreaterThanOrEqual(9);
    for (const at of sent)
      expect(sent.filter((t) => t > at - 3_600_000 && t <= at).length).toBeLessThanOrEqual(4);
    const before = limited.sent.length;
    await within(1_000, store.listSafeMessages(W[2], {}));
    expect(limited.sent.length).toBeLessThanOrEqual(before + 1);
  });

  it("asks nothing about Safes the screen does not depend on (valid members, sets that can no longer be signed), and nothing while nobody uses the app", async () => {
    await load();
    const safe = fakeSafe();
    await pageRead(safe, [A, B]);
    const activity = { on: false };
    // B's member is valid (or its set closed): the engine does not name it.
    const screen = { set: [A] as Address[] };
    store.startSafeWatch(watcher(screen, activity));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(safe.sent).toHaveLength(2);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "idle",
      watched: null,
    });

    // Someone uses the app: the engine starts the watcher; A's copy is ten minutes old, asked
    // about at once; B never.
    activity.on = true;
    const since = Date.now();
    store.startSafeWatch(watcher(screen, activity));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(background(safe, since).map((s) => [s.kind, s.safe])).toEqual([
      ["newest", A.toLowerCase()],
    ]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(safe.sent.some((s) => s.safe === B.toLowerCase() && s.at >= since)).toBe(false);

    // A's member signs and becomes valid: the engine stops naming it; nothing more is asked.
    screen.set = [];
    const after = Date.now();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(background(safe, after)).toEqual([]);

    // Nobody uses the app any more: the watcher stops (no timer), and sends nothing.
    screen.set = [A];
    activity.on = false;
    const idle = Date.now();
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(background(safe, idle)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks at once about a Safe newly on screen whose copy is older than its cadence, and not before it is due otherwise", async () => {
    await load();
    const safe = fakeSafe();
    await pageRead(safe, [A]);
    await vi.advanceTimersByTimeAsync(40_000);
    await pageRead(safe, [B]);
    const screen = { set: [B] as Address[] };
    store.startSafeWatch(watcher(screen));
    const since = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    // B's copy is 30 s old: not due yet.
    expect(background(safe, since)).toEqual([]);
    // A set showing A (a minute old) comes on screen: asked about at once (the engine nudges).
    screen.set = [A, B];
    store.nudgeSafeWatch();
    await vi.advanceTimersByTimeAsync(500);
    expect(background(safe, since).map((s) => s.safe)).toEqual([A.toLowerCase()]);
  });

  it("plans again at once when a set comes on screen: its label right after uses the set's cadence, not the lists' the last plan had", async () => {
    await load({ budget: 30 });
    const safe = fakeSafe();
    const lists = safes(17, 0x400);
    const members = safes(16, 0x500);
    await pageRead(safe, [...lists, ...members]);
    const screen = { set: [] as Address[], list: lists };
    store.startSafeWatch(watcher(screen));
    await vi.advanceTimersByTimeAsync(1_000);
    // Only lists on screen: the budget stretches their cadence (and the set's would be shorter).
    const listOnly = store.safeStoreStatus().watched?.effectiveCadenceMs;
    expect(listOnly?.list).toBeGreaterThan(300_000);
    // An open set's 16 members come on screen (a page load nudges the watcher): the label the
    // page computes right after names the cadence the new plan gives them.
    screen.set = members;
    store.nudgeSafeWatch();
    const check = store.safeCheckOf(members);
    const replanned = store.safeStoreStatus().watched;
    expect(replanned?.safes).toBe(16);
    expect(check.cadenceMs).toBe(replanned?.effectiveCadenceMs.set);
    expect(check.cadenceMs).not.toBe(listOnly?.set);
    expect(Date.parse(check.nextAt as string) - Date.now()).toBeLessThanOrEqual(
      replanned?.effectiveCadenceMs.set as number
    );
  });

  it("re-reads a listing when a confirmation bumps a message's modified time, or a message is added: a new version, listeners told", async () => {
    await load();
    const safe = fakeSafe();
    for (const n of [1, 2, 3]) safe.add(A, n);
    const first = await store.listSafeMessages(A);
    const changed: string[] = [];
    store.onSafeListingChange((s) => changed.push(s));
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(safe.count("listing")).toBe(1);
    expect(safe.count("newest")).toBe(1);

    safe.confirm(A, 2);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(safe.count("listing")).toBe(2);
    const confirmed = await store.listSafeMessages(A);
    expect(confirmed.version).not.toBe(first.version);
    expect(changed).toEqual([A.toLowerCase()]);

    safe.add(A, 4);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(safe.count("listing")).toBe(3);
    expect((await store.listSafeMessages(A)).messages).toHaveLength(4);
    expect(changed).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5 * 61_000);
    expect(safe.count("listing")).toBe(3);
    expect(changed).toHaveLength(2);
  });

  it("checks the Safes behind lists on screen every 5 minutes", async () => {
    await load();
    const safe = fakeSafe();
    const sources = safes(17);
    await pageRead(safe, sources);
    const since = Date.now();
    store.startSafeWatch(watcher({ list: sources }));
    await vi.advanceTimersByTimeAsync(3_600_000);
    const checks = background(safe, since);
    expect(checks.length).toBeLessThanOrEqual(17 * 12);
    expect(checks.length).toBeGreaterThanOrEqual(17 * 10);
    expect(store.safeStoreStatus().watched).toMatchObject({
      safes: 0,
      lists: 17,
      effectiveCadenceMs: { list: 300_000 },
    });
    // A list's page may use those copies (5 minutes' cadence); a set's needs its own watch.
    expect(store.pageSafeListing(sources[0] as Address, "list")).not.toBeNull();
  });

  it("without a key on Safe's public service checks every 5 minutes (SYNC_SAFE_WATCH_KEYLESS_MS), or never with 0; a self-hosted service as with a key", async () => {
    await load({ key: "" });
    const safe = fakeSafe();
    const members = safes(16);
    await pageRead(safe, members);
    const since = Date.now();
    store.startSafeWatch(watcher({ set: members }));
    await vi.advanceTimersByTimeAsync(3_600_000);
    const checks = background(safe, since);
    // At most 16 x 12 (each Safe every 5 minutes), 550 ms apart at least (2 requests/s).
    expect(checks.length).toBeLessThanOrEqual(16 * 12);
    expect(checks.length).toBeGreaterThanOrEqual(16 * 11);
    expect(store.safeStoreStatus()).toMatchObject({
      paused: null,
      watched: { keyless: true, cadenceMs: { set: 300_000 }, effectiveCadenceMs: { set: 300_000 } },
    });

    store.stopSafeWatch();
    await load({ key: "", keylessMs: 0 });
    const off = fakeSafe();
    await pageRead(off, [A]);
    const before = off.sent.length;
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(off.sent).toHaveLength(before);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "keyless-public-service",
    });
    // Only on request: a page (and Fetch signatures) still reads it.
    await within(1_000, store.listSafeMessages(A));
    expect(off.sent).toHaveLength(before + 1);
    expect(store.safeCheckOf([A])).toMatchObject({ state: "on-request" });
    // A request that finds Safe's monthly quota used up: the card says so, not "only on request".
    await vi.advanceTimersByTimeAsync(61_000);
    off.limited = 3_600;
    off.exhausted = true;
    await expect(within(1_000, store.listSafeMessages(A))).rejects.toThrow();
    expect(store.safeCheckOf([A])).toMatchObject({ state: "paused", reason: "quota-exhausted" });
    off.limited = null;
    off.exhausted = false;
    store.stopSafeWatch();

    // A self-hosted service has no such limits: every minute.
    net.safeTxServiceUrl = "https://safe.example.org";
    await load({ key: "" });
    const own = fakeSafe();
    await pageRead(own, [A]);
    const start = Date.now();
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(background(own, start).length).toBeGreaterThanOrEqual(9);
  });

  it("pauses while the service's quota is below 10 %", async () => {
    await load();
    const safe = fakeSafe();
    safe.headers = { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "99" };
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, paused: "quota" });
  });

  it("on a 429 stops for the cooldown; a copy then shows unavailable, never empty, and keeps its age", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const read = await store.listSafeMessages(A);
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(safe.count("newest")).toBe(1);

    // Retry-After: 30 s.
    safe.limited = 30;
    await vi.advanceTimersByTimeAsync(61_000);
    const limitedAt = (safe.sent.at(-1) as Sent).at;
    expect(safe.count("newest")).toBe(2);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "cooldown",
      lastError: expect.stringContaining("rate limited"),
    });
    // The failed check left the copy's age as it was.
    expect(store.heldSafeListing(A)?.fetchedAt).toBeLessThan(limitedAt);
    expect(store.heldSafeListing(A)?.version).toBe(read.version);

    // During the cooldown the listing cannot be read: unavailable, never "no message".
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(store.findSafeMessage(A, messageHash(1))).rejects.toThrow("rate limited");
    expect(safe.sent.filter((s) => s.at > limitedAt)).toEqual([]);

    // After it, checks pick up again.
    safe.limited = null;
    await vi.advanceTimersByTimeAsync(90_000);
    const resumed = safe.sent.filter((s) => s.at > limitedAt);
    expect(resumed.length).toBeGreaterThan(0);
    expect((resumed[0] as Sent).at).toBeGreaterThanOrEqual(limitedAt + 30_000);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: true, lastError: null });
  });

  it("says when Safe's monthly quota is used up (not a short rate limit), also before the watcher plans again", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeWatch(watcher({ set: [A] }));
    await vi.advanceTimersByTimeAsync(61_000);
    safe.limited = 3_600;
    safe.exhausted = true;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(store.safeCheckOf([A])).toMatchObject({ state: "paused", reason: "quota-exhausted" });
    // Nobody uses the app, then someone does again: before the watcher's next look, the label
    // still says why.
    store.stopSafeWatch();
    expect(store.safeCheckOf([A])).toMatchObject({ state: "paused", reason: "quota-exhausted" });
  });

  it("names a Safe's check by its turn in the queue, not by when its copy came due (several due at once)", async () => {
    await load();
    const safe = fakeSafe();
    const safes = W.slice(0, 4);
    await pageRead(safe, safes);
    store.startSafeWatch(watcher({ set: safes }));
    // A minute on, all four are due at once: checked one at a time, 15 s apart (the first just
    // now). The other three wait their turns, about 15, 30 and 45 s away: never all "now".
    await vi.advanceTimersByTimeAsync(60_500);
    const next = safes.map((s) => Date.parse(store.safeCheckOf([s]).nextAt as string) - Date.now());
    const sorted = [...next].sort((a, b) => a - b);
    expect(sorted.slice(0, 3).map((ms) => Math.round(ms / 15_000))).toEqual([1, 2, 3]);
    // The one just checked: its next minute.
    expect(sorted[3]).toBeGreaterThan(45_000);
  });

  it("backs off a Safe whose reads keep failing while it is watched (15 s x 2^n, at most 5 min), so it cannot take the others' turns", async () => {
    await load();
    const safe = fakeSafe();
    await pageRead(safe, [A, B]);
    safe.failing.add(A.toLowerCase());
    store.startSafeWatch(watcher({ set: [A, B] }));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const failed = safe.sent.filter((s) => s.safe === A.toLowerCase() && s.kind === "newest");
    const gaps = failed.slice(1).map((s, i) => s.at - (failed[i] as Sent).at);
    // Later and later (never before its turn: one Safe at a time, 30 s apart for two), then
    // every 5 minutes.
    expect(gaps.slice(-3).map((g) => Math.round(g / 10_000) * 10)).toEqual([300, 300, 300]);
    expect(failed.length).toBeLessThanOrEqual(12);
    // B goes on as usual, about every minute.
    expect(safe.sent.filter((s) => s.safe === B.toLowerCase()).length).toBeGreaterThanOrEqual(25);
    expect(store.safeStoreStatus()).toMatchObject({
      failingSafes: 1,
      lastError: expect.stringContaining("HTTP 500"),
    });
    // Answering again: as usual.
    safe.failing.clear();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(store.safeStoreStatus()).toMatchObject({ failingSafes: 0, lastError: null });
  });

  it("drops a background answer that arrives after a settings change", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const first = await store.listSafeMessages(A);
    store.startSafeWatch(watcher({ set: [A] }));
    safe.latencyMs = 1_000;
    await vi.advanceTimersByTimeAsync(60_500);
    expect(safe.count("newest")).toBe(1);
    api.resetSafeClient();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.safeListingVersion(A)).toBeNull();
    expect(first.version).toBeGreaterThan(0);
  });

  it("on a dev node asks only while the engine's side says someone uses the app (Safe is not the chain)", async () => {
    net.isDevNode = true;
    await load();
    const safe = fakeSafe();
    await pageRead(safe, [A]);
    const activity = { on: false };
    store.startSafeWatch(watcher({ set: [A] }, activity));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, paused: "idle" });
    activity.on = true;
    store.startSafeWatch(watcher({ set: [A] }, activity));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(safe.count("newest", A)).toBe(1);
  });

  it("reports its state JSON-safe, without the service URL", async () => {
    await load();
    const safe = fakeSafe();
    await pageRead(safe, [A]);
    store.startSafeWatch(watcher({ set: [A], list: [B] }));
    await vi.advanceTimersByTimeAsync(5_000);
    const status = store.safeStoreStatus();
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    expect(JSON.stringify(status)).not.toContain("safe.global");
    expect(status).toMatchObject({ groups: [], baseline: null, watched: { safes: 1, lists: 1 } });
  });
});

describe("the copies a page may use (the page rule)", () => {
  it("any copy at most 60 s old; one the watcher keeps checking within its cadence (10 s more once it confirmed it); never the last run's", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    safe.add(B, 1);
    await store.listSafeMessages(A);
    await within(1_000, store.listSafeMessages(B));
    // Not watched: only while at most 60 s old.
    await vi.advanceTimersByTimeAsync(60_000 - (Date.now() - NOW));
    expect(store.pageSafeListing(A, "set")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.pageSafeListing(A, "set")).toBeNull();
    expect(store.pageSafeListing(A, "list")).toBeNull();

    // Watched (A as an open set's member, B behind a list), its checks failing: a copy read
    // before the Safe was watched counts only within the cadence (60 s for A, so not any more;
    // 5 min for B), never twice it.
    safe.failing.add(A.toLowerCase());
    safe.failing.add(B.toLowerCase());
    store.startSafeWatch(watcher({ set: [A], list: [B] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.pageSafeListing(A, "set")).toBeNull();
    expect(store.pageSafeListing(B, "list")).not.toBeNull();
    // A copy a list's watch keeps is not one a set's page may use.
    expect(store.pageSafeListing(B, "set")).toBeNull();
    const read = store.heldSafeListing(B)?.fetchedAt as number;
    await vi.advanceTimersByTimeAsync(read + 300_000 - Date.now());
    expect(store.pageSafeListing(B, "list")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.pageSafeListing(B, "list")).toBeNull();
    // A page then reads it at request priority, as JSON would.
    safe.failing.clear();
    const before = safe.sent.length;
    await within(1_000, store.listSafeMessagesForPage(B, "list"));
    expect(safe.sent.length).toBe(before + 1);

    // A copy confirmed while the Safe is watched: within its cadence and 10 s (the check that
    // replaces it is under way), here with that check failing; then read again as JSON would.
    const confirmed = (await within(1_000, store.listSafeMessagesForPage(A, "set"))).fetchedAt;
    safe.failing.add(A.toLowerCase());
    await vi.advanceTimersByTimeAsync(confirmed + 70_000 - Date.now());
    expect(store.pageSafeListing(A, "set")?.fetchedAt).toBe(confirmed);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.pageSafeListing(A, "set")).toBeNull();
    // A copy B's watcher confirmed (its checks answer again): 5 min and 10 s.
    const listed = store.pageSafeListing(B, "list")?.fetchedAt as number;
    safe.failing.add(B.toLowerCase());
    await vi.advanceTimersByTimeAsync(listed + 310_000 - Date.now());
    expect(store.pageSafeListing(B, "list")?.fetchedAt).toBe(listed);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.pageSafeListing(B, "list")).toBeNull();

    // Nobody uses the app: the watcher stops; only copies at most 60 s old count.
    safe.failing.clear();
    await within(1_000, store.listSafeMessagesForPage(B, "list"));
    store.stopSafeWatch();
    expect(store.pageSafeListing(B, "list")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(store.pageSafeListing(B, "list")).toBeNull();

    // The last run's copies: never (only a page's labelled first answer uses them).
    const kept = { safe: W[0], messages: [], complete: true, fetchedAt: Date.now() };
    expect(store.holdLastRunListings([kept])).toBe(1);
    expect(store.pageSafeListing(W[0], "set")).toBeNull();
  });

  it("keeps every watched copy within its cadence when many come due together (a page read them all at once): the first checks start early, one at a time, none late", async () => {
    await load();
    const safe = fakeSafe();
    safe.latencyMs = 400;
    const members = safes(16);
    for (const [i, member] of members.entries()) safe.add(member, i + 1);
    // An open set's 16 members come on screen (watched), and the page's request reads them all
    // at once.
    store.startSafeWatch(watcher({ set: members }));
    await within(
      10_000,
      Promise.all(members.map((member) => store.listSafeMessagesForPage(member, "set")))
    );
    const from = safe.sent.length;
    let worst = 0;
    for (let t = 0; t < 600; t++) {
      await vi.advanceTimersByTimeAsync(1_000);
      for (const member of members) {
        const copy = store.heldSafeListing(member) as { fetchedAt: number };
        worst = Math.max(worst, Date.now() - copy.fetchedAt);
        expect(store.pageSafeListing(member, "set")).not.toBeNull();
      }
    }
    // Within the cadence and the 10 s a copy confirmed while watched may run over (a check's
    // answer); at the cadence's pace, about one check each a minute (the first round a little
    // sooner than due), one small request each.
    expect(worst).toBeLessThanOrEqual(60_000 + 10_000);
    const checks = safe.sent.slice(from);
    expect(checks.every((s) => s.kind === "newest")).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(16 * 9);
    expect(checks.length).toBeLessThanOrEqual(16 * 11);
  });

  // An open set's members and the Safes behind a list on screen at once (the set's page and the
  // emergency list in two tabs), every copy read together by the pages: the list's Safes come due
  // together, and must not hold the set's members (60 s) past their bound, nor the other way round.
  const MIXED = [
    { name: "no quota headers (the budget alone)", sets: 5, lists: 17, headers: {} },
    { name: "Safe's quota early in its period", sets: 5, lists: 17, headers: QUOTA_HEADERS },
    {
      name: "a mainnet-like 149 an hour",
      sets: 5,
      lists: 17,
      headers: {
        "x-ratelimit-limit": "50000",
        "x-ratelimit-remaining": "32350",
        "x-ratelimit-reset": "2160000",
      },
    },
    { name: "16 set and 17 list Safes, quota early", sets: 16, lists: 17, headers: QUOTA_HEADERS },
    // A Safe whose reads keep failing is retried sooner than its cadence at first (15 s, 30 s, ...
    // at most 5 min), which the plan does not count: its retries take only starts no kept copy
    // needs, so the healthy copies stay within their bound.
    {
      name: "two list Safes failing, quota early",
      sets: 5,
      lists: 17,
      headers: QUOTA_HEADERS,
      failing: 2,
      minutes: 60,
    },
    {
      name: "three list Safes failing, 16 set Safes, quota early",
      sets: 16,
      lists: 17,
      headers: QUOTA_HEADERS,
      failing: 3,
      minutes: 60,
    },
  ];
  for (const mixed of MIXED)
    it(`set and list Safes watched together (${mixed.name}): no healthy copy outside its page bound for ${mixed.minutes ?? 30} minutes, within the allowance`, async () => {
      await load();
      const safe = fakeSafe();
      safe.latencyMs = 400;
      safe.headers = mixed.headers;
      const sets = safes(mixed.sets, 0x300);
      const lists = safes(mixed.lists, 0x500);
      for (const [i, member] of [...sets, ...lists].entries()) safe.add(member, i + 1);
      store.startSafeWatch(watcher({ set: sets, list: lists }));
      await vi.advanceTimersByTimeAsync(100);
      await within(
        10_000,
        Promise.all([
          ...sets.map((member) => store.listSafeMessagesForPage(member, "set")),
          ...lists.map((member) => store.listSafeMessagesForPage(member, "list")),
        ])
      );
      const failing = lists.slice(0, mixed.failing ?? 0);
      for (const member of failing) safe.failing.add(member.toLowerCase());
      const healthy = lists.slice(failing.length);
      const minutes = mixed.minutes ?? 30;
      const from = safe.sent.length;
      const misses = { set: 0, list: 0 };
      for (let t = 0; t < minutes * 60; t++) {
        await vi.advanceTimersByTimeAsync(1_000);
        for (const member of sets) if (store.pageSafeListing(member, "set") === null) misses.set++;
        for (const member of healthy)
          if (store.pageSafeListing(member, "list") === null) misses.list++;
      }
      expect(misses).toEqual({ set: 0, list: 0 });
      const watched = store.safeStoreStatus().watched;
      // Planned at 80 % of the allowance, never above it in any hour's share.
      const allowance = watched?.allowancePerHour as number;
      expect(safe.sent.length - from).toBeLessThanOrEqual((allowance * minutes) / 60);
    });

  it("set Safes with two of them failing and Fetch signatures on half of them every 3 minutes: the healthy copies stay within their bound", async () => {
    await load();
    const safe = fakeSafe();
    safe.latencyMs = 400;
    const members = safes(16, 0x300);
    for (const [i, member] of members.entries()) safe.add(member, i + 1);
    store.startSafeWatch(watcher({ set: members }));
    await vi.advanceTimersByTimeAsync(100);
    await within(
      10_000,
      Promise.all(members.map((member) => store.listSafeMessagesForPage(member, "set")))
    );
    safe.failing.add((members[0] as Address).toLowerCase());
    safe.failing.add((members[1] as Address).toLowerCase());
    const healthy = members.slice(2);
    let misses = 0;
    for (let t = 0; t < 30 * 60; t++) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (t % 180 === 0) void store.checkSafesNow(members.slice(8));
      for (const member of healthy) if (store.pageSafeListing(member, "set") === null) misses++;
    }
    expect(misses).toBe(0);
  });
});

describe("the viewer's own signature (a burst of reads)", () => {
  it("reads the Safe at once, every 5 s for 30 s, then every 15 s up to 2 min: 13 reads at most, without a key too", async () => {
    await load({ key: "" });
    const safe = fakeSafe();
    safe.add(A, 1);
    const start = Date.now();
    expect(store.safeBurst(A, () => true)).toBe(true);
    // One burst at a time per Safe.
    expect(store.safeBurst(A, () => true)).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const reads = safe.sent.filter((s) => s.safe === A.toLowerCase());
    expect(reads.map((s) => (s.at - start) / 1_000)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 105, 120,
    ]);
    expect(reads.every((s) => s.kind === "listing")).toBe(true);
    expect(store.safeStoreStatus().bursts).toBe(0);
    expect(store.burstsRunning()).toBe(0);
  });

  it("stops at the first new version of the listing (the signature arrived)", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(1_000);
    const start = Date.now();
    store.safeBurst(A, () => true);
    await vi.advanceTimersByTimeAsync(12_000);
    safe.confirm(A, 1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent.filter((s) => s.at >= start).map((s) => (s.at - start) / 1_000)).toEqual([
      0, 5, 10, 15,
    ]);
    expect(store.heldSafeListing(A)?.messages[0]?.confirmations).toHaveLength(2);
  });

  it("counts toward the hourly budget, stops when it is spent, and when nobody uses the app", async () => {
    await load({ budget: 3 });
    const safe = fakeSafe();
    safe.add(A, 1);
    store.safeBurst(A, () => true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent).toHaveLength(3);
    expect(store.safeStoreStatus().budgetUsedThisHour).toBe(3);

    await load();
    const other = fakeSafe();
    other.add(B, 1);
    const use = { on: true };
    store.safeBurst(B, () => use.on);
    await vi.advanceTimersByTimeAsync(7_000);
    use.on = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(other.sent).toHaveLength(2);
  });
});

describe("Fetch signatures (checkSafesNow)", () => {
  it("asks about each Safe now, at a request's priority, whatever its copy's age: unchanged, its copy is confirmed (newer)", async () => {
    await load();
    const safe = fakeSafe();
    for (const s of W) safe.add(s, 1);
    for (const s of W) await within(1_000, store.listSafeMessages(s));
    await vi.advanceTimersByTimeAsync(30_000);
    // Background reads queued (the boot warm-up's, say) wait behind it.
    const warm = [A, B].map((s) => {
      safe.add(s, 1);
      return store.warmSafeListing(s);
    });
    const since = Date.now();
    const check = store.checkSafesNow(W.slice(0, 3));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await check).toEqual({ checked: 3, failed: [] });
    await Promise.all(warm);
    const order = safe.sent.filter((s) => s.at >= since).map((s) => s.safe);
    // The warm-up's first read may already have started; the check's three go before the rest.
    expect(order.indexOf(B.toLowerCase())).toBeGreaterThan(order.indexOf(W[2].toLowerCase()));
    for (const s of W.slice(0, 3)) {
      expect(safe.count("newest", s)).toBe(1);
      expect(Date.now() - (store.heldSafeListing(s)?.fetchedAt ?? 0)).toBeLessThanOrEqual(5_000);
    }
  });

  it("joins a read in flight, asks about a copy however recent, and names the Safes Safe did not answer for", async () => {
    await load();
    const safe = fakeSafe();
    for (const s of [A, B, W[0]]) safe.add(s, 1);
    await within(1_000, store.listSafeMessages(B));
    safe.latencyMs = 500;
    const reading = store.listSafeMessages(A);
    await vi.advanceTimersByTimeAsync(10);
    safe.failing.add(W[0].toLowerCase());
    const sent = safe.sent.length;
    const check = store.checkSafesNow([A, B, W[0]]);
    await vi.advanceTimersByTimeAsync(5_000);
    await reading;
    expect(await check).toEqual({ checked: 2, failed: [W[0]] });
    // A joined the read in flight; B (read a moment ago) and W1 were asked (W1 failed).
    expect(
      safe.sent
        .slice(sent)
        .map((s) => s.safe)
        .sort()
    ).toEqual([B.toLowerCase(), W[0].toLowerCase()].sort());
  });
});

describe("background reads (warm-up, precomputing)", () => {
  it("are refused before taking a start slot when the budget is spent, so a page's read starts at once", async () => {
    await load({ budget: 0 }); // with a key: 220 ms between requests
    const safe = fakeSafe();
    safe.add(A, 1);
    safe.add(B, 1);
    await expect(store.listSafeMessages(A, { background: true })).rejects.toThrow("budget");
    const page = store.listSafeMessages(B);
    await vi.advanceTimersByTimeAsync(0);
    expect(safe.sent.map((s) => s.safe)).toEqual([B.toLowerCase()]);
    expect((await page).messages).toHaveLength(1);
  });

  it("are never sent to the public service without a key", async () => {
    await load({ key: "" });
    const safe = fakeSafe();
    safe.add(A, 1);
    await expect(store.warmSafeListing(A)).rejects.toThrow("keyless-public-service");
    await expect(store.findSafeMessage(A, messageHash(1), { background: true })).rejects.toThrow(
      "keyless-public-service"
    );
    expect(safe.sent).toEqual([]);
    // A page's read is.
    expect(await store.findSafeMessage(A, messageHash(1))).toMatchObject({
      messageHash: messageHash(1),
    });
  });

  it("read a listing the last run kept in full, without a change check first", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const kept = { safe: A, messages: [], complete: true, fetchedAt: Date.now() - 3_600_000 };
    expect(store.holdLastRunListings([kept])).toBe(1);
    const snapshot = await within(1_000, store.warmSafeListing(A));
    expect(safe.sent.map((s) => s.kind)).toEqual(["listing"]);
    expect(snapshot.fromLastRun).toBeUndefined();
    expect(snapshot.messages).toHaveLength(1);
    // This run's listing is change-checked as usual: unchanged, it is not read again.
    vi.advanceTimersByTime(61_000);
    await within(1_000, store.warmSafeListing(A));
    expect(safe.sent.map((s) => s.kind)).toEqual(["listing", "newest"]);
  });

  it("put nothing on screen, and leave lookups by hash to requests", async () => {
    await load();
    const safe = fakeSafe();
    // More messages than the five pages a listing reads: the oldest is not in it.
    for (let n = 1; n <= 501; n++) safe.add(A, n);
    const failed = expect(
      store.findSafeMessage(A, messageHash(1), { background: true })
    ).rejects.toThrow("lookup by hash");
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;
    expect(safe.count("listing", A)).toBe(5);
    expect(safe.count("message")).toBe(0);
    // In the listing: found without a request.
    expect(await store.findSafeMessage(A, messageHash(501), { background: true })).toMatchObject({
      messageHash: messageHash(501),
    });

    // Nothing on screen: the watcher leaves A alone.
    store.startSafeWatch(watcher({}));
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(safe.count("newest")).toBe(0);
    expect(safe.count("listing", A)).toBe(5);

    // A request looks the message up by hash.
    expect(await within(5_000, store.findSafeMessage(A, messageHash(1)))).toMatchObject({
      messageHash: messageHash(1),
    });
    expect(safe.count("message")).toBe(1);
  });
});
