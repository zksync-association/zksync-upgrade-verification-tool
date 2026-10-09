import type { SafeMessage } from "@/.server/safe-api";
import type { SafeGroups, SafeSweepDriver } from "@/.server/safe/store";
import { type Address, type Hex, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Safe snapshot store: listings served while at most 60 s old (from the answer's arrival),
// older ones read again for the request ahead of background work, and the background sweep that
// keeps the listings of recently viewed signer groups fresh with one small change check per Safe,
// within its hourly budget, never keyless on the public service and never during a cooldown.
// Driven by a fake Safe Transaction Service and fake timers.

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
const G = [1, 2].map((n) => address(0x200 + n));

type Sent = { at: number; safe: string | null; kind: "listing" | "newest" | "message" };

/** A Safe Transaction Service that orders, pages and rate limits like the real one. */
function fakeSafe() {
  const service = {
    lists: new Map<string, SafeMessage[]>(),
    sent: [] as Sent[],
    latencyMs: 0,
    /** Answer 429 with this Retry-After (seconds) while set. */
    limited: null as number | null,
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
        return new Response("Rate limited", {
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

async function load({ key = "test-key", budget }: { key?: string; budget?: number } = {}) {
  vi.resetModules();
  // An empty value also keeps dotenv from setting one.
  vi.stubEnv("SAFE_API_KEY", key);
  if (budget !== undefined) vi.stubEnv("SYNC_SAFE_HOURLY_BUDGET", String(budget));
  cache = await import("@/.server/cache");
  api = await import("@/.server/safe-api");
  store = await import("@/.server/safe/store");
}

/** The sync engine's side of the sweep: active while `on`, groups as given. */
function driver(groups: Partial<SafeGroups>, activity = { on: true }): SafeSweepDriver {
  return {
    active: () => activity.on,
    groups: async () => ({ securityCouncil: [], guardians: [], zkFoundation: [], ...groups }),
  };
}

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
  store?.stopSafeSweep();
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

  it("at 61 s reads only the stale Safes, ahead of the sweep's queued reads", async () => {
    await load(); // with a key: 220 ms between requests
    const safe = fakeSafe();
    for (const s of [A, B, ...W]) safe.add(s, 1);
    // A page asked for A, for a Security Council member (W1), and 30 s later for B.
    await within(1_000, store.listSafeMessages(W[0]));
    await within(1_000, store.listSafeMessages(A));
    await vi.advanceTimersByTimeAsync(28_000);
    await within(1_000, store.listSafeMessages(B));
    await vi.advanceTimersByTimeAsync(61_000 - (Date.now() - NOW) + 1_500);

    // The sweep queues its five reads (W1's change check, the other members' listings) ...
    const since = Date.now();
    store.startSafeSweep(driver({ securityCouncil: W }));
    await vi.advanceTimersByTimeAsync(1);
    expect(background(safe, since)).toHaveLength(1);
    // ... and a page needs A (61 s old) and B (31 s old).
    const [a, b] = [store.listSafeMessages(A), store.listSafeMessages(B)];
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await a).fetchedAt).toBeGreaterThan(since);
    expect((await b).fetchedAt).toBeLessThan(since);

    const sent = background(safe, since).map((s) => [s.kind, s.safe]);
    expect(sent).toEqual([
      ["newest", W[0].toLowerCase()],
      // A goes next, before the sweep's queued listings; B is not read at all.
      ["listing", A.toLowerCase()],
      ...W.slice(1).map((s) => ["listing", s.toLowerCase()]),
    ]);
    const starts = background(safe, since).map((s) => s.at);
    for (let i = 1; i < starts.length; i++)
      expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(220);
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

describe("the background sweep", () => {
  it("keeps a viewed group's listings fresh with one change check per Safe, never re-reading unchanged listings", async () => {
    await load();
    const safe = fakeSafe();
    for (const n of [1, 2, 3]) safe.add(W[0], n);
    safe.add(W[1], 1);
    const first = await store.listSafeMessages(W[0]);
    await within(1_000, store.listSafeMessages(W[1]));
    store.startSafeSweep(driver({ securityCouncil: [W[0], W[1]], guardians: G }));

    // Ten minutes in use: every listing a page reads is at most 60 s old, without a request.
    for (let t = 0; t < 10; t++) {
      await vi.advanceTimersByTimeAsync(61_000);
      const before = safe.sent.length;
      const listing = await store.listSafeMessages(W[0]);
      expect(safe.sent.length).toBe(before);
      expect(Date.now() - listing.fetchedAt).toBeLessThanOrEqual(60_000);
      expect(listing.version).toBe(first.version);
    }
    // After the first listings, only change checks, each Safe about every 50 s.
    expect(safe.count("listing")).toBe(2);
    const checks = safe.sent.filter((s) => s.kind === "newest" && s.safe === W[0].toLowerCase());
    expect(checks.length).toBeGreaterThanOrEqual(11);
    expect(checks.length).toBeLessThanOrEqual(13);
    for (let i = 1; i < checks.length; i++)
      expect((checks[i] as Sent).at - (checks[i - 1] as Sent).at).toBeLessThan(60_000);
    // The Guardians were not viewed: not swept.
    expect(safe.sent.some((s) => G.some((g) => g.toLowerCase() === s.safe))).toBe(false);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: true,
      groups: ["securityCouncil"],
      paused: null,
      lastError: null,
    });
  });

  it("re-reads a listing when a confirmation bumps a message's modified time, or a message is added", async () => {
    await load();
    const safe = fakeSafe();
    for (const n of [1, 2, 3]) safe.add(A, n);
    const first = await store.listSafeMessages(A);
    store.startSafeSweep(driver({ zkFoundation: [A] }));
    await vi.advanceTimersByTimeAsync(55_000);
    expect(safe.count("listing")).toBe(1);
    expect(safe.count("newest")).toBe(1);

    // An owner confirms an older message: it becomes the newest by modification.
    safe.confirm(A, 2);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(safe.count("listing")).toBe(2);
    const confirmed = await store.listSafeMessages(A);
    expect(
      confirmed.messages.find((m) => m.messageHash === messageHash(2))?.confirmations
    ).toHaveLength(2);
    expect(confirmed.version).not.toBe(first.version);

    // A new message raises the count.
    safe.add(A, 4);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(safe.count("listing")).toBe(3);
    const added = await store.listSafeMessages(A);
    expect(added.messages).toHaveLength(4);
    expect(added.version).not.toBe(confirmed.version);

    // Nothing new: change checks only, the version stays.
    await vi.advanceTimersByTimeAsync(150_000);
    expect(safe.count("listing")).toBe(3);
    expect((await store.listSafeMessages(A)).version).toBe(added.version);
    expect(safe.count("listing")).toBe(3);
  });

  it("never sweeps the public service without a key (a self-hosted one is fine)", async () => {
    await load({ key: "" });
    const safe = fakeSafe();
    safe.add(W[0], 1);
    await store.listSafeMessages(W[0]);
    store.startSafeSweep(driver({ securityCouncil: W }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "keyless-public-service",
      budgetUsedThisHour: 0,
    });

    store.stopSafeSweep();
    net.safeTxServiceUrl = "http://127.0.0.1:18546";
    await store.listSafeMessages(W[0]);
    store.startSafeSweep(driver({ securityCouncil: W }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(safe.count("listing", W[1])).toBe(1);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: true, paused: null });
  });

  it("stops at the hourly budget (the request path still reads), and resumes as the hour rolls on", async () => {
    await load({ budget: 4 });
    const safe = fakeSafe();
    for (const s of W.slice(0, 3)) safe.add(s, 1);
    for (const s of W.slice(0, 3)) await within(1_000, store.listSafeMessages(s));
    const start = Date.now();
    store.startSafeSweep(driver({ securityCouncil: W.slice(0, 3) }));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    // The requests above were a page's; the sweep sent four of its own, then paused.
    expect(background(safe, start)).toHaveLength(4);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "budget",
      budgetUsedThisHour: 4,
      budgetPerHour: 4,
    });
    // A page still reads what it needs, at once.
    const before = safe.sent.length;
    await within(1_000, store.listSafeMessages(W[2]));
    expect(safe.sent.length).toBe(before + 1);

    // An hour after the first background requests the budget has room again; a page views the
    // group again (the last view was 31 min ago), and the sweep resumes within the budget.
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await within(1_000, store.listSafeMessages(W[0]));
    const resumed = Date.now();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(background(safe, resumed).length).toBeGreaterThan(0);
    expect(store.safeStoreStatus().budgetUsedThisHour).toBeLessThanOrEqual(4);
  });

  it("pauses while the service's quota is below 10 %", async () => {
    await load();
    const safe = fakeSafe();
    safe.headers = { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "99" };
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeSweep(driver({ securityCouncil: [A] }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, paused: "quota" });
  });

  it("on a 429 stops for the cooldown; a stale listing is then unavailable, never empty", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeSweep(driver({ securityCouncil: [A] }));
    await vi.advanceTimersByTimeAsync(55_000);
    expect(safe.count("newest")).toBe(1);

    // Retry-After: 30 s.
    safe.limited = 30;
    await vi.advanceTimersByTimeAsync(50_000);
    const limitedAt = (safe.sent.at(-1) as Sent).at;
    expect(safe.count("newest")).toBe(2);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: false,
      paused: "cooldown",
      lastError: expect.stringContaining("rate limited"),
    });

    // 70 s after the last good answer, during the cooldown: the listing cannot be read. The
    // lookup fails (a member shows as unavailable) instead of finding no message (missing).
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(store.findSafeMessage(A, messageHash(1))).rejects.toThrow("rate limited");
    const { collectMessages } = await import("@/.server/flows/messages");
    const collected = await collectMessages([A], ["ExecuteEmergencyUpgradeSecurityCouncil"], {
      name: "EmergencyUpgradeBoard",
      version: "1",
      chainId: 1,
      verifyingContract: B,
    });
    expect(collected.groups).toEqual([]);
    expect(collected.errors).toEqual([expect.stringContaining("rate limited")]);
    // Nothing was sent during the cooldown.
    expect(safe.sent.filter((s) => s.at > limitedAt)).toEqual([]);

    // After it, the sweep picks up again.
    safe.limited = null;
    await vi.advanceTimersByTimeAsync(60_000);
    const resumed = safe.sent.filter((s) => s.at > limitedAt);
    expect(resumed.length).toBeGreaterThan(0);
    expect((resumed[0] as Sent).at).toBeGreaterThanOrEqual(limitedAt + 30_000);
    expect(await store.findSafeMessage(A, messageHash(1))).toMatchObject({
      messageHash: messageHash(1),
    });
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: true, lastError: null });
  });

  it("drops a background answer that arrives after a settings change", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    const first = await store.listSafeMessages(A);
    store.startSafeSweep(driver({ securityCouncil: [A] }));
    safe.latencyMs = 1_000;
    await vi.advanceTimersByTimeAsync(50_500);
    expect(safe.count("newest")).toBe(1);
    api.resetSafeClient();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.safeListingVersion(A)).toBeNull();
    expect(first.version).toBeGreaterThan(0);
  });

  it("sweeps only groups viewed in the last SYNC_SAFE_ACTIVE_MS, and stops when the app is idle", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    const activity = { on: true };
    store.startSafeSweep(driver({ guardians: [A] }, activity));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const swept = safe.count("newest");
    expect(swept).toBeGreaterThan(3);
    // Nobody looked at the Guardians for 5 minutes: no more sweeping.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    const settled = safe.count("newest");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.count("newest")).toBe(settled);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, groups: [] });

    // Viewed again: swept again, until the engine goes idle.
    await within(1_000, store.listSafeMessages(A));
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(safe.count("newest")).toBeGreaterThan(settled);
    activity.on = false;
    await vi.advanceTimersByTimeAsync(10_000);
    const idle = safe.sent.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent.length).toBe(idle);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, paused: "idle" });
  });

  it("never sweeps on a dev node", async () => {
    await load();
    net.isDevNode = true;
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeSweep(driver({ securityCouncil: [A] }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(safe.sent).toHaveLength(1);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, paused: "dev-node" });
  });

  it("with little budget left, checks the most overdue listings first, and only as many as fit", async () => {
    await load({ budget: 3 });
    const safe = fakeSafe();
    for (const s of W) safe.add(s, 1);
    // A page read the members one second apart, the last one first.
    for (const s of [...W].reverse()) await within(1_000, store.listSafeMessages(s));
    await vi.advanceTimersByTimeAsync(58_000);
    // All five are due at once, with room for three requests.
    const since = Date.now();
    store.startSafeSweep(driver({ securityCouncil: W }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(background(safe, since).map((s) => [s.kind, s.safe])).toEqual(
      [W[4], W[3], W[2]].map((s) => ["newest", s.toLowerCase()])
    );
    expect(store.safeStoreStatus()).toMatchObject({ paused: "budget", budgetUsedThisHour: 3 });
  });

  it("keeps 17 member Safes fresh within the default budget, checking each later than 50 s when it must", async () => {
    await load();
    const safe = fakeSafe();
    safe.latencyMs = 100;
    const members = Array.from({ length: 17 }, (_, i) => address(0x300 + i));
    for (const s of members) safe.add(s, 1);
    store.startSafeSweep(
      driver({
        securityCouncil: members.slice(0, 8),
        guardians: members.slice(8, 16),
        zkFoundation: members.slice(16),
      })
    );
    // A page reads every member's listing every 10 s, for two hours.
    for (let t = 0; t < 720; t++) {
      const at = Date.now();
      const page = Promise.all(members.map((s) => store.listSafeMessages(s)));
      await vi.advanceTimersByTimeAsync(10_000);
      if (t > 0)
        for (const listing of await page)
          expect(listing.fetchedAt).toBeGreaterThanOrEqual(at - 60_000);
    }
    // Only the first page read listings; the sweep's change checks did the rest, spaced to fit
    // 95 % of the budget (17 x 3600 s / 1140 = 53.7 s), never pausing on it.
    expect(safe.count("listing")).toBe(17);
    const checks = safe.sent.filter(
      (s) => s.kind === "newest" && s.safe === members[5]?.toLowerCase()
    );
    for (let i = 1; i < checks.length; i++) {
      const gap = (checks[i] as Sent).at - (checks[i - 1] as Sent).at;
      expect(gap).toBeGreaterThanOrEqual(53_685);
      expect(gap).toBeLessThan(55_000);
    }
    const status = store.safeStoreStatus();
    expect(status).toMatchObject({ sweeping: true, paused: null, failingSafes: 0 });
    expect(status.budgetUsedThisHour).toBeLessThanOrEqual(1_140);
  });

  it("backs off member Safes whose reads keep failing, so they cannot use up the budget the others need", async () => {
    await load(); // the default budget
    const safe = fakeSafe();
    safe.latencyMs = 100;
    const council = Array.from({ length: 8 }, (_, i) => address(0x300 + i));
    const guardians = Array.from({ length: 8 }, (_, i) => address(0x400 + i));
    const foundation = [address(0x500)];
    const members = [...council, ...guardians, ...foundation];
    for (const s of members) safe.add(s, 1);
    // As seen live: two members' listings answer HTTP 500, every time.
    const failing = [council[7], guardians[7]] as Address[];
    for (const s of failing) safe.failing.add(s.toLowerCase());
    const healthy = members.filter((s) => !failing.includes(s));
    store.startSafeSweep(driver({ securityCouncil: council, guardians, zkFoundation: foundation }));
    // A page reads every member's listing (as the emergency page does), once a minute for an hour.
    for (let minute = 0; minute < 60; minute++) {
      const at = Date.now();
      const page = Promise.allSettled(members.map((s) => store.listSafeMessages(s)));
      await vi.advanceTimersByTimeAsync(60_000);
      for (const [i, result] of (await page).entries()) {
        if (failing.includes(members[i] as Address)) {
          expect(result.status).toBe("rejected");
          continue;
        }
        expect(result.status).toBe("fulfilled");
        const listing = (result as PromiseFulfilledResult<{ fetchedAt: number }>).value;
        expect(listing.fetchedAt).toBeGreaterThanOrEqual(at - 60_000);
      }
    }
    // The healthy Safes' listings were read once, by the first page: never again on demand.
    expect(healthy.reduce((n, s) => n + safe.count("listing", s), 0)).toBe(healthy.length);
    // The failing ones: the page's own reads (one a minute) and a few retries in the first minutes.
    for (const s of failing) expect(safe.count(undefined, s)).toBeLessThanOrEqual(64);
    const status = store.safeStoreStatus();
    expect(status).toMatchObject({
      sweeping: true,
      paused: null,
      failingSafes: 2,
      lastError: expect.stringContaining("HTTP 500"),
    });
    expect(status.budgetUsedThisHour).toBeLessThan(1_140);
  });

  it("retries a failing Safe 15 s, 30 s, 60 s ... apart (at most 5 min), and as usual once it answers", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    safe.add(B, 1);
    safe.failing.add(B.toLowerCase());
    await store.listSafeMessages(A);
    const failed = expect(store.listSafeMessages(B)).rejects.toThrow("HTTP 500");
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    store.startSafeSweep(driver({ securityCouncil: [A, B] }));
    // A page views A once a minute, keeping the group (and so B) swept.
    const view = async (minutes: number) => {
      for (let m = 0; m < minutes; m++) {
        await vi.advanceTimersByTimeAsync(60_000);
        await store.listSafeMessages(A);
      }
    };
    for (let m = 0; m < 60; m++) {
      await view(1);
      // A succeeding all along does not hide B's failure.
      expect(store.safeStoreStatus()).toMatchObject({
        failingSafes: 1,
        lastError: expect.stringContaining("HTTP 500"),
      });
    }
    const tries = safe.sent.filter((s) => s.safe === B.toLowerCase()).map((s) => s.at);
    const gaps = tries.slice(1).map((at, i) => at - (tries[i] as number));
    expect(gaps.length).toBeGreaterThan(8);
    for (const [i, gap] of gaps.entries()) {
      const backoff = Math.min(300_000, 15_000 * 2 ** i);
      expect(gap).toBeGreaterThanOrEqual(backoff);
      expect(gap).toBeLessThan(backoff + 1_000);
    }
    // About 17 tries in the hour, against 240 at a flat 15 s; A was kept fresh by change checks.
    expect(tries.length).toBeLessThanOrEqual(20);
    expect(safe.count("listing", A)).toBe(1);

    // B answers again: read at its next retry, then checked like A (about every 50 s).
    safe.failing.clear();
    await view(5);
    expect(store.safeStoreStatus()).toMatchObject({ failingSafes: 0, lastError: null });
    const since = Date.now();
    await view(5);
    const checks = background(safe, since).filter((s) => s.safe === B.toLowerCase());
    expect(checks.every((s) => s.kind === "newest")).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(5);
    expect(checks.length).toBeLessThanOrEqual(7);
  });

  it("does not count the boot warm-up as a page's interest", async () => {
    await load();
    const safe = fakeSafe();
    for (const s of W) safe.add(s, 1);
    await within(5_000, Promise.all(W.map((s) => store.warmSafeListing(s))));
    expect(safe.count("listing")).toBe(W.length);
    store.startSafeSweep(driver({ securityCouncil: W }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(safe.sent).toHaveLength(W.length);
    expect(store.safeStoreStatus()).toMatchObject({ sweeping: false, groups: [] });

    // A page views one member: the group is swept from then on.
    await within(1_000, store.listSafeMessages(W[0]));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(safe.count("newest", W[1])).toBeGreaterThan(0);
    expect(safe.count("listing", W[1])).toBe(1);
    expect(store.safeStoreStatus()).toMatchObject({
      sweeping: true,
      groups: ["securityCouncil"],
    });
  });

  it("reports its state JSON-safe, without the service URL", async () => {
    await load();
    const safe = fakeSafe();
    safe.add(A, 1);
    await store.listSafeMessages(A);
    store.startSafeSweep(driver({ securityCouncil: [A] }));
    await vi.advanceTimersByTimeAsync(120_000);
    const status = store.safeStoreStatus();
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    expect(JSON.stringify(status)).not.toContain("safe.global");
    expect(Date.now() - Date.parse(status.oldestFetchedAt as string)).toBeLessThanOrEqual(60_000);
    expect(status).toMatchObject({ sweeping: true, groups: ["securityCouncil"] });
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

  it("do not mark a page's interest, and leave lookups by hash to requests", async () => {
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

    // Not a page's interest: the sweep leaves A's group alone.
    store.startSafeSweep(driver({ securityCouncil: [A] }));
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
