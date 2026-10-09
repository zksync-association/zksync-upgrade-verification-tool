import {
  CONDITIONS,
  type Cost,
  HEAD_OFFSETS_MS,
  type StatusLike,
  TARGETS,
  costRate,
  formatRow,
  httpFailure,
  indexesSettled,
  markSeen,
  newHead,
  pageMarkers,
  pickCost,
  scrubbed,
  servedState,
  shortPath,
  statusSummary,
  trustProblems,
  worstByPath,
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
    expect(CONDITIONS).toContain("use");
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

describe("costRate", () => {
  it("turns two rolling one-hour counts into requests an hour between them", () => {
    const rate = costRate(cost(1_000, 40), cost(1_100, 57), 600_000);
    expect(rate).toEqual({
      rpcPerHour: 600,
      l1RpcPerHour: 600,
      l2RpcPerHour: 0,
      safePerHour: 102,
      rpcRequests: 100,
      safeRequests: 17,
      minutes: 10,
      exact: true,
    });
  });

  it("says when the counts no longer cover the whole interval", () => {
    expect(costRate(cost(1, 0), cost(2, 0, 3_600_000), 600_000).exact).toBe(false);
    expect(costRate(cost(1, 0), cost(2, 0), 0).rpcPerHour).toBe(0);
  });
});
