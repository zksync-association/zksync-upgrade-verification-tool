import {
  AGENT_SESSION,
  CONDITIONS,
  type Cost,
  DEFAULT_CONDITIONS,
  FIRST_FLUSH_MS,
  HEAD_OFFSETS_MS,
  type Measurement,
  PAGES,
  RESUME_JSON,
  type StatusLike,
  TARGETS,
  type Trace,
  chainOf,
  checkMark,
  dataInFirstFlush,
  engineSummary,
  firstFlushOf,
  formatRow,
  formatWindow,
  httpFailure,
  indexesSettled,
  jsonResumeResult,
  markSeen,
  methodOf,
  newHead,
  overlapsReserved,
  pageMarkers,
  pagesAfterPauseChecks,
  parseArgs,
  peakCreditsPerSecond,
  pickCost,
  scrubbed,
  servedState,
  shortPath,
  silent,
  statusSummary,
  stepOf,
  stoppableSleep,
  summarizeTrace,
  trustProblems,
  watcherResult,
  worstByPath,
  cacheReloaded,
} from "../support/benchmark-sync";
import { EMERGENCY_ID, UPGRADE_ID } from "../support/fixtures";

// The read-only benchmark's own logic (test/support/benchmark-sync.ts): when it stops, what it
// prints, and how it reads pages and costs. Importing it starts no server.

const OK: StatusLike = {
  ok: true,
  governance: { warnings: [], network: { label: "Ethereum Mainnet", overrides: [] } },
  logHistory: { status: "ok" },
  safeApi: { withKey: true, quota: { limit: 50_000, remaining: 41_000 } },
  sync: {
    index: { state: "ready" },
    l2Index: { state: "ready", governors: ["0x1"] },
    cache: { state: "verified", file: "1-0xd4e56740.json", savedAt: null, sizeBytes: 10 },
    engine: { mode: "always", active: true, head: { number: "26139302" }, cost: undefined },
  },
};

const cost = (rpc: number, safe: number, windowMs = 600_000): Cost => ({
  rpcPerHour: rpc,
  l1RpcPerHour: rpc - 10,
  l2RpcPerHour: 10,
  safePerHour: safe,
  windowMs,
  mode: "idle",
});

describe("trustProblems", () => {
  it("accepts a clean status", () => {
    expect(trustProblems(OK)).toEqual([]);
  });

  it("stops on everything AGENTS.md says to stop and report on", () => {
    expect(trustProblems({ ok: false })).toEqual(["/api/status is not ok"]);
    expect(trustProblems({ ...OK, governance: { ...OK.governance, warnings: ["x"] } })).toEqual([
      "governance.warnings has 1 entries",
    ]);
    expect(
      trustProblems({
        ...OK,
        governance: { warnings: [], network: { label: "x", overrides: ["a", "b"] } },
      })
    ).toEqual(["governance.network.overrides has 2 entries"]);
    for (const status of ["missing", "error", "unchecked"])
      expect(trustProblems({ ...OK, logHistory: { status } })).toEqual([
        `logHistory.status is ${status}`,
      ]);
    expect(trustProblems({ ...OK, logHistory: undefined })).toEqual([
      "logHistory.status is absent",
    ]);
    expect(trustProblems({ ...OK, sync: { ...OK.sync, cache: { state: "mismatch" } } })).toEqual([
      "sync.cache.state is mismatch",
    ]);
  });
});

describe("what is printed", () => {
  it("never carries a URL from the status", () => {
    const status = {
      ...OK,
      safeApi: { ...OK.safeApi, url: "https://safe.example/api?key=secret" },
      clientVersion: "Geth/v1 https://rpc.example/v3/secret",
      sync: {
        ...OK.sync,
        engine: {
          ...OK.sync?.engine,
          cost: { ...cost(5, 1), note: "https://rpc.example/v3/secret" } as Cost,
        },
      },
    } as StatusLike;
    const printed = JSON.stringify(statusSummary(status));
    expect(printed).not.toContain("://");
    expect(printed).not.toContain("secret");
    expect(statusSummary(status)).toMatchObject({
      chain: "Ethereum Mainnet",
      logHistory: "ok",
      cache: { state: "verified", file: "1-0xd4e56740.json" },
      engine: { head: "26139302", cost: cost(5, 1) },
    });
    expect(pickCost(undefined)).toBeNull();
  });

  it("shortens ids in paths and rows", () => {
    expect(shortPath(`/api/upgrades/${UPGRADE_ID}`)).toBe("/api/upgrades/0x77d5…");
    const row = formatRow("fresh", {
      path: `/app/proposals/${UPGRADE_ID}`,
      status: 200,
      ttfbMs: 29,
      completeMs: 4511,
      bytes: 1,
      marks: { shell: 30, core: 30, data: 1430, sets: 4506 },
    });
    expect(row).toContain("/app/proposals/0x77d5…");
    expect(row).toContain("ttfb 29 · core 30 · data 1,430 · sets 4,506 · complete 4,511 ms");
    expect(
      formatRow("warm", { path: "/api/vetoes", status: 200, ttfbMs: 2, completeMs: 3, bytes: 1 })
    ).toMatch(/complete 3 ms$/);
    expect(
      formatRow("idle", {
        path: "/api/vetoes",
        status: 0,
        ttfbMs: -1,
        completeMs: 120_000,
        bytes: 0,
        error: "TimeoutError",
      })
    ).toContain("failed (TimeoutError) after 120,000 ms");
  });

  it("scrubs URLs from an unexpected error", () => {
    expect(scrubbed(new Error("fetch https://rpc.example/v3/key failed\nstack"))).toBe(
      "fetch <url> failed"
    );
  });
});

describe("pages", () => {
  it("looks for each page's own content", () => {
    expect(Object.keys(pageMarkers(`/app/proposals/${UPGRADE_ID}`))).toEqual([
      "shell",
      "core",
      "data",
      "sets",
      "labelled",
    ]);
    expect(Object.keys(pageMarkers(`/app/emergency/${EMERGENCY_ID}`))).toContain("sets");
    expect(Object.keys(pageMarkers("/app/emergency?history=all"))).toContain("pending");
    expect(Object.keys(pageMarkers("/app/l2-cancellations"))).toContain("vetoable");
    expect(Object.keys(pageMarkers("/app/unknown"))).toEqual(["shell", "labelled"]);
    // A list whose data is in the first flush has its core content then too.
    expect(pageMarkers("/app/proposals").core).toEqual(
      expect.arrayContaining([...(pageMarkers("/app/proposals").data ?? [])])
    );
  });

  it("records each marker the first time any of its strings appears", () => {
    const markers = pageMarkers("/app/emergency");
    const seen: Record<string, number> = {};
    markSeen('<nav aria-label="Governance navigation">', markers, seen, 5);
    markSeen('<h2 id="pending-emergencies-heading">', markers, seen, 9);
    markSeen("No pending emergency upgrades were found", markers, seen, 40);
    markSeen('<nav aria-label="Governance navigation"> again', markers, seen, 70);
    expect(seen).toEqual({ shell: 5, core: 9, pending: 40 });
    markSeen("No emergency executions in the last 7 days.", markers, seen, 80);
    expect(seen.data).toBe(80);
    expect(seen.labelled).toBeUndefined();
  });

  it("notes when something labelled as older or unconfirmed is first shown", () => {
    for (const html of [
      '<div data-testid="set-securityCouncil" data-stale="true">',
      '<div role="status" data-testid="set-stale">',
      '<p data-testid="summary-note">Safe copies from 2m ago · re-verifying</p>',
      '<div role="status" data-testid="last-run">',
      '<span data-testid="last-run-check" data-source="direct">',
    ]) {
      const seen: Record<string, number> = {};
      markSeen(html, pageMarkers(`/app/proposals/${UPGRADE_ID}`), seen, 12);
      expect(seen.labelled).toBe(12);
    }
    // A current set's quiet freshness line is not a label of older data.
    const seen: Record<string, number> = {};
    markSeen(
      '<p data-testid="set-freshness">Verified at block #26,139,302 · Safe copies from 4s ago</p>',
      pageMarkers(`/app/proposals/${UPGRADE_ID}`),
      seen,
      12
    );
    expect(seen.labelled).toBeUndefined();
  });

  it("measures the JSON twin of every page it measures", () => {
    const pages = TARGETS.filter((t) => t.page).map((t) => t.path);
    const json = TARGETS.filter((t) => !t.page).map((t) => t.path);
    expect(pages).toHaveLength(6);
    expect(json).toEqual(
      expect.arrayContaining([
        "/api/status",
        "/api/upgrades",
        `/api/upgrades/${UPGRADE_ID}`,
        "/api/emergency",
        `/api/emergency/${EMERGENCY_ID}`,
        "/api/vetoes",
      ])
    );
  });
});

// A page as measured: first bytes, and when each marker first appeared.
const page = (path: string, ttfbMs: number, marks: Record<string, number>): Measurement => ({
  path,
  status: 200,
  ttfbMs,
  completeMs: Math.max(ttfbMs, ...Object.values(marks)),
  bytes: 1,
  marks: { shell: ttfbMs, ...marks },
  firstFlush: firstFlushOf(ttfbMs, { shell: ttfbMs, ...marks }),
});

// "pages after 10m" as the October 8 run measured them: the first page waited for the head.
const AFTER_10M = [
  page("/", 30, { core: 31, data: 438, labelled: 438 }),
  page("/app/proposals", 14, { core: 15, data: 17 }),
  page(`/app/proposals/${UPGRADE_ID}`, 16, { core: 17, data: 21, sets: 23, labelled: 23 }),
  page("/app/emergency", 9, { core: 10, data: 11, pending: 11 }),
  page(`/app/emergency/${EMERGENCY_ID}`, 12, { core: 13, data: 14, sets: 153, labelled: 153 }),
  page("/app/l2-cancellations", 8, { core: 8, data: 10, vetoable: 10 }),
];

describe("the first flush after a pause (acceptance target 5)", () => {
  it("is what came within FIRST_FLUSH_MS of the first bytes, in order", () => {
    expect(FIRST_FLUSH_MS).toBe(50);
    expect(firstFlushOf(27, { shell: 27, core: 27, data: 476, labelled: 493 })).toEqual({
      byMs: 77,
      marks: ["shell", "core"],
    });
    expect(firstFlushOf(9, { labelled: 13, shell: 9, data: 11, sets: 59, core: 10 })).toEqual({
      byMs: 59,
      marks: ["shell", "core", "data", "labelled", "sets"],
    });
  });

  it("needs the page's data in it, current or labelled: frame and sections alone do not count", () => {
    // October 8, "/" after 90 s: first bytes in 27 ms, its data (labelled) after the head read.
    expect(dataInFirstFlush(page("/", 27, { core: 27, data: 476, labelled: 493 }))).toBe(false);
    // The same page warm: its data at once.
    expect(dataInFirstFlush(page("/", 7, { core: 8, data: 9 }))).toBe(true);
    // Something older shown labelled in the first flush counts too.
    expect(dataInFirstFlush(page("/", 7, { core: 8, labelled: 20, data: 400 }))).toBe(true);
    // First bytes at FIRST_FLUSH_MS or later never do, whatever came with them.
    expect(dataInFirstFlush(page("/", 50, { core: 50, data: 51 }))).toBe(false);
    expect(dataInFirstFlush({ ...page("/", 5, { data: 6 }), status: 503, error: "HTTP 503" })).toBe(
      false
    );
    // Without the precomputed flush (an older results file): from the marks.
    const { firstFlush: _flush, ...bare } = page("/", 7, { core: 8, data: 9 });
    expect(dataInFirstFlush(bare)).toBe(true);
  });

  it("fails acceptance 5 where only the first bytes were in time, and says which pages", () => {
    const [bytes, data] = pagesAfterPauseChecks("pages after 10m", AFTER_10M);
    expect(bytes).toMatchObject({ ok: true });
    expect(bytes?.what).toContain("first bytes only");
    expect(data).toMatchObject({ ok: false, detail: { without: ["/"] } });
    expect(data?.what).toContain("acceptance 5");
    // Every page with its data at once: both hold.
    const atOnce = AFTER_10M.map((m) => page(m.path, 9, { core: 10, data: 12 }));
    expect(pagesAfterPauseChecks("x", atOnce).map((c) => c.ok)).toEqual([true, true]);
    // A page missing (it failed to load, or was not measured): neither holds.
    expect(pagesAfterPauseChecks("x", atOnce.slice(1)).map((c) => c.ok)).toEqual([false, false]);
  });
});

describe("answers that are not results", () => {
  it("reports an HTTP error status as a failure, never as a timing", () => {
    expect(httpFailure(200)).toBeUndefined();
    expect(httpFailure(304)).toBeUndefined();
    expect(httpFailure(404)).toBe("HTTP 404");
    expect(httpFailure(500)).toBe("HTTP 500");
    expect(httpFailure(503)).toBe("HTTP 503");
    expect(
      formatRow("warm", {
        path: "/api/emergency",
        status: 503,
        ttfbMs: 4,
        completeMs: 5,
        bytes: 10,
        error: "HTTP 503",
      })
    ).toContain("failed (HTTP 503) after 5 ms");
  });
});

describe("right after a new block", () => {
  const at = (iso: string) => Date.parse(iso);
  const status = (head: Record<string, unknown> | null): StatusLike => ({
    ...OK,
    sync: { ...OK.sync, engine: { ...OK.sync?.engine, head } },
  });

  it("finds a head other than the previous one, and when the engine saw and served it", () => {
    const seen = status({
      number: "26139303",
      observedAt: "2026-10-07T10:00:00.000Z",
      servedAt: null,
    });
    expect(newHead(seen, "26139302")).toEqual({
      number: "26139303",
      observedAt: at("2026-10-07T10:00:00.000Z"),
      servedAt: null,
    });
    // Not new.
    expect(newHead(seen, "26139303")).toBeNull();
    const served = status({
      number: "26139303",
      observedAt: "2026-10-07T10:00:00.000Z",
      servedAt: "2026-10-07T10:00:00.912Z",
    });
    expect(newHead(served, "26139302")?.servedAt).toBe(at("2026-10-07T10:00:00.912Z"));
    // No head, or none the benchmark can time.
    expect(newHead(status(null), null)).toBeNull();
    expect(newHead(status({ number: "1", observedAt: "not a time" }), null)).toBeNull();
    expect(newHead(status({ number: "1" }), null)).toBeNull();
  });

  it("tells whether a request went out before the engine served the head it was timed against", () => {
    const head = { number: "7", observedAt: 1_000, servedAt: null };
    // Still not served once the answer was in: sent (and answered) before.
    expect(servedState(head, "7", 1_100)).toEqual({ sentBeforeServed: true, servedAt: null });
    expect(servedState({ ...head, servedAt: 1_700 }, "7", 1_500)).toEqual({
      sentBeforeServed: true,
      servedAt: 1_700,
    });
    expect(servedState({ ...head, servedAt: 1_700 }, "7", 2_000)).toEqual({
      sentBeforeServed: false,
      servedAt: 1_700,
    });
    // A newer head already: unknown.
    expect(servedState({ ...head, number: "8" }, "7", 1_100)).toEqual({
      sentBeforeServed: null,
      servedAt: null,
    });
    expect(servedState(null, "7", 1_100)).toEqual({ sentBeforeServed: null, servedAt: null });
  });

  it("measures the JSON detail endpoints from the moment the head is seen to well after it is served", () => {
    expect([...HEAD_OFFSETS_MS]).toEqual([0, 250, 500, 750, 1_000, 1_500]);
    expect(CONDITIONS).toContain("head");
    expect(CONDITIONS).toContain("resume");
  });

  it("notes the slowest answer per path, leaving failures out", () => {
    const row = (path: string, completeMs: number, context?: Record<string, unknown>) => ({
      path,
      status: 200,
      ttfbMs: 1,
      completeMs,
      bytes: 1,
      ...(context ? { context } : {}),
    });
    const worst = worstByPath([
      row("/api/upgrades/0x1", 6, { offsetMs: 0 }),
      row("/api/upgrades/0x1", 420, { offsetMs: 500 }),
      row("/api/upgrades/0x1", 9, { offsetMs: 1_000 }),
      row("/api/vetoes", 4),
      { ...row("/api/vetoes", 120_000), status: 0, error: "TimeoutError" },
    ]);
    expect(worst).toEqual({
      "/api/upgrades/0x1": { completeMs: 420, context: { offsetMs: 500 } },
      "/api/vetoes": { completeMs: 4, context: null },
    });
  });
});

describe("indexesSettled", () => {
  it("waits for both log indexes, or an L2 index with nothing to read", () => {
    expect(indexesSettled(OK)).toBe(true);
    expect(indexesSettled({ sync: { ...OK.sync, index: { state: "backfilling" } } })).toBe(false);
    expect(indexesSettled({ sync: { ...OK.sync, l2Index: { state: "backfilling" } } })).toBe(false);
    expect(
      indexesSettled({ sync: { ...OK.sync, l2Index: { state: "idle", governors: ["0x1"] } } })
    ).toBe(false);
    expect(
      indexesSettled({ sync: { ...OK.sync, l2Index: { state: "idle", governors: [] } } })
    ).toBe(true);
    expect(indexesSettled({ sync: { ...OK.sync, l2Index: { state: "unavailable" } } })).toBe(true);
  });
});

describe("the conditions", () => {
  it("runs what the October 8 benchmark measures by default, and one server per path only on request", () => {
    expect(DEFAULT_CONDITIONS).toEqual(
      expect.arrayContaining([
        "json",
        "upgrade",
        "idle",
        "pages",
        "hidden",
        "resume",
        "home",
        "veto",
        "open",
        "keyless",
        "always",
        "late",
        "warm",
        "head",
        "restart",
      ])
    );
    expect(DEFAULT_CONDITIONS).not.toContain("fresh");
    expect(DEFAULT_CONDITIONS).not.toContain("cache");
    expect(CONDITIONS).toEqual(expect.arrayContaining(["fresh", "cache"]));
  });

  it("resumes on the chain-only JSON and the six pages; an agent's session reads as AGENTS.md does", () => {
    expect(RESUME_JSON.map((t) => t.path)).toEqual([
      "/api/status",
      "/api/upgrades",
      "/api/upgrades?history=all",
    ]);
    expect(PAGES).toHaveLength(6);
    expect(AGENT_SESSION.every((t) => !t.page && t.path.startsWith("/api/"))).toBe(true);
    expect(AGENT_SESSION.map((t) => t.path)).toContain(`/api/upgrades/${UPGRADE_ID}`);
  });

  it("parses its arguments, and never takes port 3000", () => {
    expect(parseArgs([]).conditions).toEqual(new Set(DEFAULT_CONDITIONS));
    expect(parseArgs([]).port).toBe(3105);
    expect(parseArgs([]).scale).toBe(1);
    const options = parseArgs(["--only=json,idle", "--port=3205", "--scale=0.1"]);
    expect(options.conditions).toEqual(new Set(["json", "idle"]));
    expect(options).toMatchObject({ port: 3205, scale: 0.1 });
    expect(parseArgs([`--open=/app/emergency/${EMERGENCY_ID}`]).openPath).toBe(
      `/app/emergency/${EMERGENCY_ID}`
    );
    expect(() => parseArgs(["--only=nope"])).toThrow("Unknown condition");
    expect(() => parseArgs(["--port=2998"])).toThrow("3000");
    expect(() => parseArgs(["--port=3000"])).toThrow("3000");
    // 3001 is the preview's too: neither may be among the six ports.
    expect(() => parseArgs(["--port=3001"])).toThrow("3001");
    expect(() => parseArgs(["--port=2995"])).toThrow("3001");
    expect(parseArgs(["--port=2994"]).port).toBe(2994);
    expect(parseArgs(["--port=3002"]).port).toBe(3002);
    expect(overlapsReserved(3000, 3000)).toBe(true);
    expect(overlapsReserved(3001, 3001)).toBe(true);
    expect(overlapsReserved(2996, 3001)).toBe(true);
    expect(overlapsReserved(3002, 3007)).toBe(false);
    expect(overlapsReserved(3105, 3105)).toBe(false);
    expect(() => parseArgs(["--scale=0"])).toThrow("--scale");
    expect(() => parseArgs(["--open=https://example.com"])).toThrow("--open");
    expect(() => parseArgs(["--what"])).toThrow("Unknown argument");
  });
});

describe("the checks", () => {
  const json = (
    label: string,
    path: string,
    completeMs: number,
    context: Record<string, unknown>
  ) => ({
    path,
    status: 200,
    ttfbMs: completeMs,
    completeMs,
    bytes: 1,
    label,
    context,
  });

  it("times only JSON requests that came after a pause of their own against warm (acceptance 4)", () => {
    const rows = [
      json("json after 90s", "/api/upgrades", 537, { ownPause: true }),
      json("json after 90s warm", "/api/upgrades", 3, { ownPause: true, warm: true }),
      json("json after 10m", "/api/status", 425, { ownPause: true }),
      json("json after 10m warm", "/api/status", 3, { ownPause: true, warm: true }),
      // Right after /api/status: it found the head and governance that one read.
      json("json after 10m", "/api/upgrades", 2_500, { ownPause: false }),
      json("json after 10m warm", "/api/upgrades", 2, { ownPause: false, warm: true }),
    ];
    const { ok, detail } = jsonResumeResult(rows);
    expect(ok).toBe(true);
    expect(detail).toEqual({
      firsts: [
        { label: "json after 90s", path: "/api/upgrades", firstMs: 537, warmMs: 3 },
        { label: "json after 10m", path: "/api/status", firstMs: 425, warmMs: 3 },
      ],
      followed: [{ label: "json after 10m", path: "/api/upgrades", ms: 2_500 }],
    });
    // A first request more than ~1 s slower than warm fails it.
    expect(
      jsonResumeResult([
        json("json after 1h", "/api/status", 1_500, { ownPause: true }),
        json("json after 1h warm", "/api/status", 3, { ownPause: true, warm: true }),
      ]).ok
    ).toBe(false);
    // No first request at all: not evaluated, never "ok".
    expect(jsonResumeResult(rows.filter((r) => r.context.ownPause === false)).ok).toBeNull();
  });

  it("holds what the Safe watcher sent to its bound, and does not evaluate one paused that sent nothing", () => {
    const at = (safePerHour: number, paused: string | null) => {
      const summary = summarizeTrace({ chains: {}, events: [] }, 600_000);
      summary.safe.perHour = safePerHour;
      // A ten-minute window.
      summary.safe.requests = Math.round(safePerHour / 6);
      const engine = engineSummary({});
      return {
        summary,
        engine: { ...engine, safe: { paused, budgetUsedThisHour: 0, watched: null } },
      };
    };
    // October 8 without a key: Safe's public service had the IP in a cooldown, so 0 an hour.
    expect(watcherResult(at(0, "cooldown"), 17, 204)).toMatchObject({
      ok: null,
      detail: { notEvaluated: "the Safe watcher was paused (cooldown) and sent nothing" },
    });
    expect(watcherResult(at(138, null), 5, 300).ok).toBe(true);
    expect(watcherResult(at(400, null), 5, 300).ok).toBe(false);
    // A watcher that spent its hourly budget pauses itself: what it sent still counts.
    expect(watcherResult(at(400, "budget"), 5, 300)).toMatchObject({ ok: false });
    expect(watcherResult(at(400, "budget"), 5, 300).detail).not.toHaveProperty("notEvaluated");
    expect(watcherResult(at(120, "quota"), 5, 300).ok).toBe(true);
    expect(checkMark(null)).toBe("n/a ");
    expect(checkMark(true)).toBe("ok  ");
    expect(checkMark(false)).toBe("FAIL");
  });

  it("passes a restart's chain cache only when it was loaded and then verified", () => {
    expect(cacheReloaded("provisional", "verified")).toBe(true);
    expect(cacheReloaded("verified", "verified")).toBe(true);
    // Loaded, but never verified; or never loaded: both fail.
    expect(cacheReloaded("provisional", "provisional")).toBe(false);
    expect(cacheReloaded("provisional", "absent")).toBe(false);
    expect(cacheReloaded("absent", "verified")).toBe(false);
    expect(cacheReloaded(null, null)).toBe(false);
  });

  it("ends a stoppable sleep without an unhandled rejection when nobody awaits it", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const stop = new AbortController();
      void stoppableSleep(60_000, stop.signal);
      const awaited = stoppableSleep(60_000, stop.signal);
      stop.abort(new Error("stopped"));
      await expect(awaited).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

// A trace as test/support/upstream-trace.mjs writes it: host "a" is L1, "b" ZKsync Era.
const call = (m: string, extra: Record<string, unknown> = {}) => ({ m, ...extra });
const CHECK_SIGNATURES = "0x194b1ee6"; // checkSignatures(bytes32,address[],bytes[],uint256)
const IS_VALID_SIGNATURE = "0x1626ba7e";
const SIGNED_MESSAGES = "0x5ae6bd37";

describe("what a server sent upstream, by step", () => {
  it("tells the L1 and ZKsync Era RPCs apart by the chain id they answered", () => {
    const trace = { chains: { a: 1, b: 324, c: 11_155_111, d: 300 } };
    expect(chainOf(trace, "a")).toBe("l1");
    expect(chainOf(trace, "b")).toBe("era");
    expect(chainOf(trace, "c")).toBe("l1");
    expect(chainOf(trace, "d")).toBe("era");
    // One the app never asked its chain id: the other RPC than the L1 one, or named as Era.
    expect(chainOf(trace, "z")).toBe("era");
    expect(chainOf({ chains: {} }, "z")).toBe("unknown");
    expect(chainOf({ chains: {} }, "z", "era")).toBe("era");
    expect(chainOf({ chains: { b: 324 } }, "z")).toBe("unknown");
  });

  it("names each L1 entry's step from its method, block tag and selector", () => {
    expect(stepOf("l1", call("eth_getBlockByNumber", { tag: "latest" }))).toBe("head poll");
    expect(stepOf("l1", call("eth_getBlockByNumber", { tag: "finalized" }))).toBe(
      "head poll (finalized)"
    );
    expect(stepOf("l1", call("eth_getBlockByNumber", { tag: 26_000_000 }))).toBe("block by number");
    expect(stepOf("l1", call("eth_getLogs", { span: 97 }))).toBe("index tail");
    expect(stepOf("l1", call("eth_getLogs", { span: 1 }))).toBe("log-history canary");
    expect(stepOf("l1", call("eth_getLogs", { span: 10_001 }))).toBe("history backfill");
    expect(stepOf("l1", call("eth_getLogs", { tag: "hash" }))).toBe("logs by hash");
    expect(stepOf("l1", call("eth_call", { mc: 41, tag: 26_000_000 }))).toBe("aggregate3");
    for (const sel of [CHECK_SIGNATURES, IS_VALID_SIGNATURE, SIGNED_MESSAGES])
      expect(stepOf("l1", call("eth_call", { sel }))).toBe("verdict (direct)");
    expect(stepOf("l1", call("eth_call", { sel: "0x12345678" }))).toBe("eth_call (direct)");
    // members(uint256): where governance's member lists end.
    expect(stepOf("l1", call("eth_call", { sel: "0x5daf08ca" }))).toBe(
      "governance members (direct)"
    );
    expect(stepOf("l1", call("eth_getCode"))).toBe("code");
    expect(stepOf("l1", call("eth_chainId"))).toBe("network");
    expect(stepOf("l1", call("eth_getTransactionReceipt"))).toBe("transaction");
  });

  it("names Era entries apart", () => {
    expect(stepOf("era", call("eth_getBlockByNumber", { tag: "latest" }))).toBe("Era head");
    expect(stepOf("era", call("eth_getLogs", { span: 40 }))).toBe("Era index tail");
    expect(stepOf("era", call("eth_call", { sel: "0x3e4f49e6" }))).toBe("Era calls");
    expect(stepOf("era", call("zks_getL1BatchBlockRange"))).toBe("Era batch");
  });

  it("counts eth_call as aggregate3 or direct, and block reads by tag", () => {
    expect(methodOf(call("eth_call", { mc: 3 }))).toBe("eth_call(aggregate3)");
    expect(methodOf(call("eth_call", { sel: "0x12345678" }))).toBe("eth_call");
    expect(methodOf(call("eth_getBlockByNumber", { tag: "latest" }))).toBe(
      "eth_getBlockByNumber(latest)"
    );
    expect(methodOf(call("eth_getBlockByNumber", { tag: 5 }))).toBe("eth_getBlockByNumber(number)");
  });

  it("finds the most credits sent in any one second", () => {
    expect(peakCreditsPerSecond([])).toBe(0);
    expect(
      peakCreditsPerSecond([
        { at: 0, credits: 80 },
        { at: 400, credits: 255 },
        { at: 999, credits: 80 },
        { at: 1_000, credits: 80 },
        { at: 5_000, credits: 255 },
      ])
    ).toBe(415);
    // Out of order is fine.
    expect(
      peakCreditsPerSecond([
        { at: 2_000, credits: 1 },
        { at: 0, credits: 5 },
        { at: 2_500, credits: 1 },
      ])
    ).toBe(5);
  });
});

describe("summarizeTrace", () => {
  const head = (n: number, at: number, host = "a") => ({
    kind: "head" as const,
    at,
    host,
    number: n,
  });
  const rpc = (at: number, calls: ReturnType<typeof call>[], extra = {}) => ({
    kind: "rpc" as const,
    at,
    host: "a",
    calls,
    status: 200,
    ...extra,
  });
  // Ten blocks in 120 s: 3 polls, a tail and an aggregate3 a block, and one finalized.
  const events: Trace["events"] = [];
  for (let b = 0; b <= 10; b++) {
    const at = b * 12_000;
    events.push(head(26_000_000 + b, at + 900));
    for (let p = 0; p < 3; p++)
      events.push(rpc(at + p * 300, [call("eth_getBlockByNumber", { tag: "latest" })]));
    if (b === 0) continue;
    events.push(rpc(at + 950, [call("eth_getLogs", { span: 90 })]));
    events.push(rpc(at + 980, [call("eth_call", { mc: 20, tag: 26_000_000 + b })]));
  }
  events.push(
    rpc(5_000, [
      call("eth_getBlockByNumber", { tag: "latest" }),
      call("eth_getBlockByNumber", { tag: "finalized" }),
    ])
  );
  const trace: Trace = { chains: { a: 1, b: 324 }, events };

  it("counts requests per block and per hour, by method and by step, with Infura credits", () => {
    const w = summarizeTrace(trace, 120_000);
    expect(w.blocks).toBe(10);
    expect(w.l1.requests).toBe(33 + 10 + 10 + 2);
    expect(w.l1.posts).toBe(33 + 10 + 10 + 1);
    expect(w.l1.perBlock).toBe(5.5);
    expect(w.l1.perHour).toBe(Math.round(55 * 30));
    expect(w.l1.byStep["head poll"]).toEqual({ n: 34, perBlock: 3.4, perHour: 1_020 });
    expect(w.l1.byStep["index tail"]?.perBlock).toBe(1);
    expect(w.l1.byStep.aggregate3?.perBlock).toBe(1);
    expect(w.l1.byStep["head poll (finalized)"]?.n).toBe(1);
    expect(w.l1.byMethod["eth_call(aggregate3)"]?.n).toBe(10);
    // getLogs 255, every other method 80.
    expect(w.l1.credits).toBe(10 * 255 + 45 * 80);
    expect(w.l1.creditsPerBlock).toBe(Math.round((10 * 255 + 45 * 80) / 10));
    expect(w.l1.aggregate3SubCalls).toEqual({ min: 20, max: 20 });
    expect(w.era.requests).toBe(0);
    expect(w.safe.requests).toBe(0);
    expect(silent(w)).toBe(false);
  });

  it("reports failed entries and HTTP failures, and Era and Safe apart", () => {
    const w = summarizeTrace(
      {
        chains: { a: 1, b: 324 },
        events: [
          rpc(0, [call("eth_getLogs", { span: 10_001 }), call("eth_getLogs", { span: 10_001 })], {
            errors: { "-32005": 2 },
            status: 429,
          }),
          {
            kind: "rpc",
            at: 10,
            host: "b",
            calls: [call("eth_getBlockByNumber", { tag: "latest" })],
            status: 200,
          },
          {
            kind: "rpc",
            at: 20,
            host: "b",
            calls: [call("eth_call", { sel: "0x3e4f49e6" })],
            failed: "TypeError",
          },
          { kind: "safe", at: 0, what: "check", safe: "0x1", status: 200 },
          { kind: "safe", at: 61_000, what: "check", safe: "0x1", status: 200 },
          { kind: "safe", at: 61_500, what: "listing", safe: "0x1", status: 200 },
          { kind: "safe", at: 70_000, what: "check", safe: "0x2", status: 429 },
          {
            kind: "rpc",
            at: 30,
            host: "z",
            calls: [call("eth_getLogs", { span: 5 })],
            status: 200,
          },
        ],
      },
      600_000
    );
    expect(w.blocks).toBeNull();
    expect(w.l1.perBlock).toBeNull();
    expect(w.l1.errors).toEqual({ "-32005": 2 });
    expect(w.l1.httpErrors).toEqual({ "429": 1 });
    expect(w.l1.byStep["history backfill"]?.n).toBe(2);
    // Host "z" never answered eth_chainId: the Era RPC (the L1 one is known).
    expect(w.era.requests).toBe(3);
    expect(w.era.byStep).toMatchObject({ "Era head": { n: 1 }, "Era calls": { n: 1 } });
    expect(w.era.httpErrors).toEqual({ TypeError: 1 });
    expect(w.era.perHour).toBe(18);
    expect(w.safe).toMatchObject({
      requests: 4,
      perHour: 24,
      byKind: { check: 3, listing: 1 },
      httpErrors: { "429": 1 },
    });
    expect(w.safe.perSafe["0x1"]).toEqual({ n: 3, kinds: "ccl", gapsS: [61, 1] });
    expect(w.unknownRpc).toBe(0);
    const unknown = summarizeTrace(
      { chains: {}, events: [{ kind: "rpc", at: 0, host: "z", calls: [call("eth_chainId")] }] },
      1_000
    );
    expect(unknown.unknownRpc).toBe(1);
    expect(silent(unknown)).toBe(false);
    expect(formatWindow("x", unknown)).toContain("RPC of unknown chain 1");
  });

  it("calls a window with nothing sent silent", () => {
    const w = summarizeTrace({ chains: { a: 1 }, events: [] }, 600_000);
    expect(silent(w)).toBe(true);
    expect(w).toMatchObject({ blocks: null, seconds: 600 });
    expect(silent(summarizeTrace({ chains: {}, events: [{ kind: "other", at: 1 }] }, 1_000))).toBe(
      false
    );
    // A head event alone is the answer to a request that was counted: here, none was.
    expect(silent(summarizeTrace({ chains: { a: 1 }, events: [head(1, 1)] }, 1_000))).toBe(true);
  });

  it("counts a request in the window it was sent in, and says when it was not answered by its end", () => {
    const w = summarizeTrace(
      {
        chains: { a: 1 },
        events: [
          rpc(0, [call("eth_getBlockByNumber", { tag: "latest" })]),
          {
            kind: "rpc",
            at: 10,
            host: "a",
            calls: [call("eth_getLogs", { span: 2 })],
            inFlight: true,
          },
          { kind: "safe", at: 20, what: "check", safe: "0x1", inFlight: true },
        ],
      },
      60_000
    );
    expect(w.l1.requests).toBe(2);
    expect(w.safe.requests).toBe(1);
    expect(w.inFlight).toBe(2);
    // Unanswered is not a failure.
    expect(w.l1.httpErrors).toEqual({});
    expect(w.safe.httpErrors).toEqual({});
    expect(silent(w)).toBe(false);
    expect(formatWindow("x", w)).toContain("2 unanswered at the end");
    expect(summarizeTrace(trace, 120_000).inFlight).toBe(0);
  });

  it("prints a window as one line, without a URL", () => {
    const line = formatWindow("upgrade", summarizeTrace(trace, 120_000));
    expect(line).toContain("10 blocks");
    expect(line).toContain("L1 5.5/block");
    expect(line).toContain("head poll 3.4");
    expect(line).toContain("Era 0 · Safe 0");
    expect(line).not.toContain("://");
    expect(formatWindow("idle 0-10m", summarizeTrace({ chains: {}, events: [] }, 600_000))).toMatch(
      /^idle 0-10m +10 min · 0 blocks · L1 0 · Era 0 · Safe 0$/
    );
  });
});

describe("engineSummary", () => {
  it("keeps the engine's counts and states, never a text that could hold a URL", () => {
    const status = {
      ...OK,
      sync: {
        ...OK.sync,
        presence: { inUse: true, reason: "tab", tabs: 1, keys: 5 },
        engine: {
          ...OK.sync?.engine,
          clock: {
            headPoll: "slot",
            recent: { blocks: 40, pollsPerBlock: 3.1, servedDelayMs: null },
          },
          lastTick: { block: "1", ms: 300, failedSteps: [] },
          cost: { ...cost(1, 0), pacer: { peakPerSecond: 415, waited: 3, creditsPerSecond: 450 } },
        },
        safe: {
          paused: null,
          budgetUsedThisHour: 12,
          lastError: "https://safe.example/api?key=secret failed",
          watched: {
            safes: 5,
            lists: 0,
            keyless: false,
            effectiveCadenceMs: { set: 86_000 },
            allowancePerHour: 210,
          },
        },
        l2: { onScreen: 0, eraBlock: "1" },
      },
    } as StatusLike;
    const summary = engineSummary(status);
    expect(summary).toMatchObject({
      active: true,
      inUse: true,
      pollsPerBlock: 3.1,
      enginePeakCreditsPerSecond: 415,
      safe: { watched: { safes: 5, allowancePerHour: 210 } },
      era: { onScreen: 0 },
    });
    expect(JSON.stringify(summary)).not.toContain("://");
    expect(engineSummary({})).toMatchObject({ active: null, safe: null, era: null });
  });
});
