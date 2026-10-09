import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Who uses the app (sync/presence.ts) and the beat endpoint (routes/resources+/presence.ts): only
// a visible tab's same-origin beat or a page load counts, for SYNC_KEEPWARM_MS; /api/*, prefetches
// and cross-site requests never do. A beat is answered from memory (nothing upstream), is never
// logged, and carries no part of the page's URL.

const engine = vi.hoisted(() => ({
  wakes: 0,
  view: { head: null as unknown, catchingUp: false },
}));
vi.mock("@/.server/sync/engine", () => ({
  wakeSync: () => {
    engine.wakes++;
  },
  syncView: () => engine.view,
}));
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({
    status: () => ({
      state: "backfilling",
      chunks: { done: 100, total: 400 },
      deployBlock: "1",
      finalizedTo: "2",
      coveredFrom: "2",
    }),
  }),
}));

const {
  PRESENCE_LIMITS,
  Presence,
  isOwnBeat,
  isPageLoad,
  pageLoad,
  parseBeat,
  presence,
  resetPresence,
  watchItems,
  watchKeys,
} = await import("@/.server/sync/presence");
const { action } = await import("@/routes/resources+/presence");
const { shouldSkipLog } = await import("@server/middlewares/logger");

const NOW = 1_800_000_000_000;
const ORIGIN = "http://localhost:3105";
const TAB = "0b5f1e9a-3c2d-4e8f-9a1b-2c3d4e5f6a7b";

const info = (method: string, path: string, headers: Record<string, string> = {}) => ({
  method,
  path,
  header: (name: string) => headers[name],
});

function beatRequest(
  body: unknown,
  headers: Record<string, string> = {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
  }
) {
  return new Request(`${ORIGIN}/resources/presence`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const post = async (request: Request) => {
  const response = (await action({ request, params: {}, context: {} } as never)) as Response;
  return { status: response.status, body: await response.json() };
};

const beat = (items: string[] = [], reason = "interval", tab = TAB) => ({
  tab,
  reason,
  items: items.map((key) => ({ key, rev: null })),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetPresence({ keepWarmMs: 30_000 });
  engine.wakes = 0;
  engine.view = { head: null, catchingUp: false };
});

afterEach(() => {
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what counts as use", () => {
  it.each([
    ["a document GET", info("GET", "/app/proposals/0xab"), true],
    ["a page's data GET (?_data=)", info("GET", "/app/proposals"), true],
    ["typed in (Sec-Fetch-Site: none)", info("GET", "/", { "sec-fetch-site": "none" }), true],
    ["from the app", info("GET", "/", { "sec-fetch-site": "same-origin" }), true],
    ["the Refresh button", info("POST", "/resources/refresh"), true],
    ["a Chrome prefetch", info("GET", "/app/emergency", { "sec-purpose": "prefetch" }), false],
    ["a prerender", info("GET", "/", { "sec-purpose": "prefetch;prerender" }), false],
    ["an older prefetch", info("GET", "/app/freeze", { purpose: "prefetch" }), false],
    ["Firefox's prefetch", info("GET", "/app/freeze", { "x-moz": "prefetch" }), false],
    [
      "a cross-site load (Safe{Wallet}'s frame)",
      info("GET", "/", { "sec-fetch-site": "cross-site" }),
      false,
    ],
    ["a same-site load", info("GET", "/", { "sec-fetch-site": "same-site" }), false],
    ["/api/status", info("GET", "/api/status"), false],
    ["/API/Status/", info("GET", "/API/Status/"), false],
    ["/api/upgrades (JSON)", info("GET", "/api/upgrades"), false],
    ["a JSON POST (/api/emergency/<id>)", info("POST", "/api/emergency/0xab"), false],
    ["the beat itself", info("POST", "/resources/presence"), false],
    ["another action", info("POST", "/settings"), false],
    ["HEAD", info("HEAD", "/"), false],
  ])("%s", (_name, request, counts) => {
    expect(isPageLoad(request)).toBe(counts);
  });

  it("a page load counts for SYNC_KEEPWARM_MS, with the keys its loader issued", () => {
    const registry = new Presence({ keepWarmMs: 30_000 });
    expect(registry.inUse()).toBe(false);
    registry.load(["upgrade:0xab"]);
    expect(registry.status()).toMatchObject({ inUse: true, reason: "page-load", tabs: 0, keys: 1 });
    vi.setSystemTime(NOW + 30_000);
    expect(registry.inUse()).toBe(true);
    vi.setSystemTime(NOW + 30_001);
    expect(registry.inUse()).toBe(false);
    expect([...registry.onScreen()]).toEqual([]);
  });

  it("a tab counts until SYNC_KEEPWARM_MS after its last beat, or until it leaves", () => {
    const registry = new Presence({ keepWarmMs: 30_000 });
    registry.beat(parseBeat(beat(["status", "set:00"])) as never);
    expect(registry.status()).toMatchObject({ inUse: true, reason: "tab", tabs: 1, keys: 2 });
    vi.setSystemTime(NOW + 25_000);
    registry.beat(parseBeat(beat(["status"])) as never);
    // A beat replaces the tab's keys.
    expect([...registry.onScreen()]).toEqual(["status"]);
    vi.setSystemTime(NOW + 55_000);
    expect(registry.inUse()).toBe(true);
    registry.beat(parseBeat(beat([], "leave")) as never);
    expect(registry.inUse()).toBe(false);
  });

  it("a tab whose viewer was away is counted as paused until it beats again", () => {
    const registry = new Presence({ keepWarmMs: 30_000 });
    registry.beat(parseBeat(beat(["status"])) as never);
    registry.beat(parseBeat({ ...beat([], "leave"), away: true }) as never);
    expect(registry.status()).toMatchObject({ inUse: false, pausedAway: 1, tabs: 0 });
    registry.beat(parseBeat(beat(["status"], "resume")) as never);
    expect(registry.status()).toMatchObject({ inUse: true, pausedAway: 0, tabs: 1 });
  });

  it("counts at most 64 tabs, dropping the one beaten least recently", () => {
    const registry = new Presence({ keepWarmMs: 600_000 });
    for (let i = 0; i < 70; i++) {
      vi.setSystemTime(NOW + i);
      registry.beat(
        parseBeat(beat([`set:${i}`], "interval", `tab-${String(i).padStart(4, "0")}`)) as never
      );
    }
    expect(registry.status().tabs).toBe(PRESENCE_LIMITS.tabs);
    expect(registry.onScreen().has("set:0")).toBe(false);
    expect(registry.onScreen().has("set:69")).toBe(true);
  });

  it("the status names no tab and no path", () => {
    const registry = new Presence({ keepWarmMs: 30_000 });
    registry.beat(parseBeat(beat(["upgrade:0xab"])) as never);
    const status = registry.status();
    expect(Object.keys(status).sort()).toEqual(
      ["inUse", "keys", "lastBeatAt", "pausedAway", "reason", "tabs"].sort()
    );
    expect(JSON.stringify(status)).not.toContain(TAB);
    expect(JSON.stringify(status)).not.toContain("upgrade:");
  });

  it("a loader's keys count only for a page load, never for a prefetch or a cross-site load", () => {
    const at = (headers: Record<string, string>) =>
      new Request(`${ORIGIN}/app/proposals/0xab?sig=0x1:0x2`, { headers });
    expect(watchItems(at({ "sec-purpose": "prefetch" }), [watchKeys.upgrade("0xAB")])).toEqual([
      { key: "upgrade:0xab", rev: null },
    ]);
    watchItems(at({ "sec-fetch-site": "cross-site" }), [watchKeys.upgrade("0xab")]);
    expect(presence().inUse()).toBe(false);
    watchItems(at({ "sec-fetch-site": "same-origin" }), [watchKeys.upgrade("0xab")]);
    expect([...presence().onScreen()]).toEqual(["upgrade:0xab"]);
  });

  it("a set found while a page loads joins that load's grace; one a prefetch or JSON finds never does", async () => {
    const { watchSignatureSet } = await import("@/.server/signatures");
    const { buildTypedData } = await import("@/common/typed-data");
    const council = "0x59195219d1176E42f8e607e9AC114926D47f9035" as const;
    const set = {
      action: "ApproveUpgradeSecurityCouncil" as const,
      signerGroup: "securityCouncil" as const,
      typedData: buildTypedData(
        "ApproveUpgradeSecurityCouncil",
        { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: council },
        { id: `0x${"ab".repeat(32)}` }
      ),
      members: [council],
      threshold: 1,
      check: { kind: "multisig" as const, contract: council },
    };
    const at = (headers: Record<string, string>) =>
      new Request(`${ORIGIN}/app/proposals/0xab`, { headers });
    // As a loader finds it: after a read (here, until `found` resolves), in the loading's own
    // continuation.
    const load = async (request: Request) => {
      let release = () => {};
      const found = new Promise<void>((resolve) => {
        release = resolve;
      });
      const page = pageLoad(request, [watchKeys.upgrade("0xab")]);
      const loading = page.run(async () => {
        await found;
        return watchSignatureSet(set).key;
      });
      release();
      return loading;
    };
    // A prefetch, a cross-site load, and JSON (no page load around it): nothing on screen.
    await load(at({ "sec-purpose": "prefetch" }));
    await load(at({ "sec-fetch-site": "cross-site" }));
    watchSignatureSet(set);
    expect(presence().inUse()).toBe(false);
    // A page load: the upgrade's key at once, the set's as soon as it is found.
    const key = await load(at({ "sec-fetch-site": "same-origin" }));
    expect(key).toMatch(/^set:[0-9a-f]{32}$/);
    expect([...presence().onScreen()].sort()).toEqual([key, "upgrade:0xab"].sort());
    // For that load's grace only.
    vi.advanceTimersByTime(30_001);
    expect(presence().inUse()).toBe(false);
    // A loader with no key of its own (a freeze request) registers its set alone.
    const freeze = pageLoad(at({ "sec-fetch-site": "same-origin" }));
    expect(freeze.watch).toEqual([]);
    expect(presence().inUse()).toBe(false);
    await freeze.run(async () => watchSignatureSet(set));
    expect([...presence().onScreen()]).toEqual([key]);
  });
});

describe("the beat's body", () => {
  it("is the tab, a reason and the server's keys: never the page's URL", () => {
    expect(parseBeat(beat(["status", "upgrade:0xab", "set:0123456789abcdef"]))).toEqual({
      tab: TAB,
      reason: "interval",
      items: [
        { key: "status", rev: null },
        { key: "upgrade:0xab", rev: null },
        { key: "set:0123456789abcdef", rev: null },
      ],
    });
    // A key can never carry a search string (?sig=…), a path or a URL.
    for (const key of ["/app/proposals/0xab", "upgrade:0xab?sig=0x1:0x2", "https://x", "a b"])
      expect(parseBeat(beat([key]))).toBeNull();
  });

  it("is refused past the limits or when malformed", () => {
    expect(parseBeat(beat(Array.from({ length: 33 }, (_, i) => `set:${i}`)))).toBeNull();
    expect(parseBeat(beat(Array.from({ length: 32 }, (_, i) => `set:${i}`)))).not.toBeNull();
    expect(parseBeat({ ...beat(), tab: "short" })).toBeNull();
    expect(parseBeat({ ...beat(), reason: "poll" })).toBeNull();
    expect(parseBeat({ ...beat([], "signed"), signed: { safe: "not-an-address" } })).toBeNull();
    expect(
      parseBeat({
        ...beat([], "signed"),
        signed: { safe: "0x59195219d1176E42f8e607e9AC114926D47f9035" },
      })
    ).toMatchObject({ signed: { safe: "0x59195219d1176E42f8e607e9AC114926D47f9035" } });
    expect(parseBeat("beat")).toBeNull();
    expect(parseBeat([beat()])).toBeNull();
  });

  it("comes only from this app's own pages, as JSON", () => {
    const json = { "content-type": "application/json" };
    expect(isOwnBeat(info("POST", "/", { ...json, "sec-fetch-site": "same-origin" }), ORIGIN)).toBe(
      true
    );
    expect(isOwnBeat(info("POST", "/", { ...json, origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(
      isOwnBeat(
        info("POST", "/", { ...json, "sec-fetch-site": "cross-site", origin: ORIGIN }),
        ORIGIN
      )
    ).toBe(false);
    expect(isOwnBeat(info("POST", "/", { ...json, origin: "https://evil.example" }), ORIGIN)).toBe(
      false
    );
    expect(isOwnBeat(info("POST", "/", json), ORIGIN)).toBe(false);
    expect(
      isOwnBeat(
        info("POST", "/", { "content-type": "text/plain", "sec-fetch-site": "same-origin" }),
        ORIGIN
      )
    ).toBe(false);
  });
});

describe("POST /resources/presence", () => {
  it("records the beat, wakes the engine and answers from memory, sending nothing upstream", async () => {
    const upstream = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", upstream);
    engine.view = {
      head: { number: 26_129_107n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_000_000n },
      catchingUp: true,
    };
    const { status, body } = await post(beatRequest(beat(["status", "upgrade:0xab"], "load")));
    expect(status).toBe(200);
    expect(body).toEqual({
      changed: [],
      unknown: [],
      catchingUp: true,
      head: { number: "26129107", hash: `0x${"ab".repeat(32)}`, timestamp: "1790000000" },
      checked: {},
      index: { state: "backfilling", percent: 25 },
      nextMs: 10_000,
    });
    expect(presence().status()).toMatchObject({ inUse: true, reason: "tab", keys: 2 });
    expect(engine.wakes).toBe(1);
    expect(upstream).not.toHaveBeenCalled();
    // A leave records the tab's end and wakes nothing.
    await post(beatRequest(beat([], "leave")));
    expect(presence().inUse()).toBe(false);
    expect(engine.wakes).toBe(1);
  });

  it("refuses a cross-origin beat or one that is not JSON (403), recording nothing", async () => {
    const refused: Record<string, string>[] = [
      { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      { "content-type": "application/json", origin: "https://evil.example" },
      { "content-type": "text/plain", "sec-fetch-site": "same-origin" },
    ];
    for (const headers of refused) {
      const { status } = await post(beatRequest(beat(["status"]), headers));
      expect(status).toBe(403);
    }
    expect(presence().inUse()).toBe(false);
    expect(engine.wakes).toBe(0);
  });

  it("refuses a body over 8 KB (413) and a malformed one (400)", async () => {
    const big = JSON.stringify({ ...beat(), pad: "x".repeat(PRESENCE_LIMITS.bodyBytes) });
    expect((await post(beatRequest(big))).status).toBe(413);
    expect((await post(beatRequest("{not json"))).status).toBe(400);
    expect((await post(beatRequest({ tab: TAB }))).status).toBe(400);
    expect(presence().inUse()).toBe(false);
  });

  it("is never logged", () => {
    expect(shouldSkipLog({ method: "POST", path: "/resources/presence" } as never)).toBe(true);
    expect(shouldSkipLog({ method: "POST", path: "/resources/presence/" } as never)).toBe(true);
    expect(shouldSkipLog({ method: "GET", path: "/app/proposals", res: {} } as never)).toBe(false);
  });
});
