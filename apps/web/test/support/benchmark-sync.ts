// Read-only benchmark of the request system (docs/performance-improvements.md, 2026-10-06): how
// long each JSON endpoint takes to answer completely, and when a page's first byte, first
// meaningful content and last byte arrive, in the conditions a signer meets:
//
//   fresh  a fresh process without the chain cache (CHAIN_CACHE=0); the request at liftoff
//   cache  a fresh process with the chain cache saved by the run before it
//   warm   the engine running, every path read once before
//   head   right after a new block: each path as soon as the engine serves a new head (requests
//          then read at it), and the JSON detail endpoints also at set times after the engine
//          first saw a new head (HEAD_OFFSETS_MS, one head each: before and after it is served).
//          The worst of these per path is noted as headWorst
//   safe   Safe copies older than 60 s while the app is in use (SYNC_SAFE_HOURLY_BUDGET=0: no
//          background Safe reads, as on an instance without a Safe API key)
//   idle   the engine idle (SYNC_KEEPWARM_MS=5000) and Safe copies older than 60 s
//   cost   sync.engine.cost of a server left alone for 10 minutes after one visit of every path
//   use    sync.engine.cost of a server kept in use for 10 minutes after one visit of every path
//          (one page a minute, default settings)
//
// It starts the production build (run `corepack pnpm --filter web build` first) on its own ports
// (--port and the four above it; never 3000), with the settings `npm start` reads (environment,
// .env, saved settings), and only ever GETs pages and /api/* from them. It prints paths, timings
// and status fields: never an RPC URL, a key, or the servers' logs (they go to
// .cache/local/benchmark-sync/ at the repository's root). It stops when /api/status reports
// governance warnings, network overrides, a log history that is not "ok", or a chain cache
// mismatch (checked when each server starts, after every measurement, and when it stops), or when
// a server's log indexes do not finish reading their history within 2 minutes. An answer with an
// HTTP error status is reported as a failure, not as a timing. "fresh" and "cache" start one server
// per path, so that every path is measured as a first request.
//
// From apps/web:
//   corepack pnpm exec tsx test/support/benchmark-sync.ts [--only=fresh,cache,...] [--port=3105]
// Results: .cache/local/benchmark-sync.json at the repository's root. A full run takes about 30
// minutes.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { EMERGENCY_ID, UPGRADE_ID } from "./fixtures";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(WEB, "../../.cache/local");
const LOGS = join(OUT, "benchmark-sync");
const HOUR_MS = 3_600_000;
// Pages are server-rendered in full for bots; a browser's user agent gets the streamed page.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
// Safe listings are served for 60 s after they arrived; the safe/idle conditions wait longer than
// that after the last request so that every listing it read is older.
const STALE_WAIT_MS = 70_000;
const IDLE_KEEPWARM_MS = 5_000;
const COST_IDLE_MS = 10 * 60_000;
// The "use" condition's page, once a minute: a visit (the engine keeps the in-use profile) that
// reads no Safe data.
const IN_USE_PATH = "/app/proposals";
const IN_USE_EVERY_MS = 60_000;
/** When the JSON detail endpoints are also measured after the engine first saw a new head. */
export const HEAD_OFFSETS_MS = [0, 250, 500, 750, 1_000, 1_500] as const;
// Background sleeps (the cost and use conditions' minutes) end when the benchmark stops.
const stopping = new AbortController();

export const CONDITIONS = [
  "fresh",
  "cache",
  "warm",
  "head",
  "safe",
  "idle",
  "cost",
  "use",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export type Target = { path: string; page: boolean };

export const TARGETS: readonly Target[] = [
  ...[
    "/api/status",
    "/api/upgrades",
    "/api/upgrades?history=all",
    `/api/upgrades/${UPGRADE_ID}`,
    "/api/emergency",
    `/api/emergency/${EMERGENCY_ID}`,
    "/api/vetoes",
    "/api/freeze",
  ].map((path) => ({ path, page: false })),
  ...[
    "/",
    "/app/proposals",
    `/app/proposals/${UPGRADE_ID}`,
    "/app/emergency",
    `/app/emergency/${EMERGENCY_ID}`,
    "/app/l2-cancellations",
  ].map((path) => ({ path, page: true })),
];

// ---- pages: what the streamed HTML shows, and when ----

/** Named things a page shows: each is seen at the first appearance of any of its strings. */
export type Markers = Record<string, readonly string[]>;

const SHELL = ['aria-label="Governance navigation"'];
// Something shown before it is current, with its label: a set's verdict at an older block or from
// Safe copies older than 60 s, a count or list from such copies, history from the last run, or an
// item located directly while the history is read (.server/signatures.ts firstSignatureSet,
// components/verification/freshness.tsx and last-run.tsx).
const LABELLED = [
  'data-stale="true"',
  'data-testid="set-stale"',
  'data-testid="summary-note"',
  'data-testid="last-run"',
  'data-testid="last-run-check"',
];

/**
 * What to look for in a page's streamed HTML: `shell` (the app shell and navigation), `core` (the
 * page's main section: its heading, its pending state or its data), `data` (its main data, stale
 * or fresh), per page what follows (signature sets, pending ids, vetoable proposals), and
 * `labelled`: the first thing shown labelled as older or unconfirmed (absent when everything the
 * page showed was current).
 */
export function pageMarkers(path: string): Markers {
  const route = path.split("?")[0] ?? path;
  return { shell: SHELL, ...routeMarkers(route), labelled: LABELLED };
}

function routeMarkers(route: string): Markers {
  if (route === "/") {
    return { core: ['data-testid="flow-upgrades"'], data: ['class="tabular-nums"'] };
  }
  if (/^\/app\/(proposals|emergency)\/0x[0-9a-fA-F]{64}$/.test(route)) {
    return {
      core: ['data-testid="page-id"'],
      data: ['data-testid="id-check"'],
      sets: ['data-testid="set-securityCouncil"'],
    };
  }
  if (route === "/app/proposals") {
    const data = [
      'data-testid="active-upgrades"',
      'data-testid="finished-upgrades"',
      'data-testid="upgrades-unavailable"',
      "In progress</h2>",
    ];
    return { core: ["Reading UpgradeStarted events", ...data], data };
  }
  if (route === "/app/emergency") {
    return {
      core: ['id="pending-emergencies-heading"'],
      data: ['data-testid="executed-emergencies"', "No emergency executions in the last"],
      pending: ['data-testid="pending-emergencies"', "No pending emergency"],
    };
  }
  if (route === "/app/l2-cancellations") {
    return {
      core: ['id="signed-vetoes-heading"'],
      data: ['data-testid="vetoes"', "No Guardian has signed a veto", "No veto was found"],
      vetoable: [
        'data-testid="vetoable"',
        'data-testid="vetoable-unavailable"',
        "No Token or GovOps governor proposal",
      ],
    };
  }
  return {};
}

/** Records at `ms` every marker that `html` (the page so far) shows for the first time. */
export function markSeen(
  html: string,
  markers: Markers,
  seen: Record<string, number>,
  ms: number
): void {
  for (const [name, texts] of Object.entries(markers))
    if (!(name in seen) && texts.some((text) => html.includes(text))) seen[name] = ms;
}

// ---- one request ----

export type Measurement = {
  path: string;
  status: number;
  /** Response headers received. */
  ttfbMs: number;
  /** The whole body received (a page: everything streamed, fresh results included). */
  completeMs: number;
  bytes: number;
  /** Pages: when each marker (pageMarkers) first appeared. */
  marks?: Record<string, number>;
  /** Why the request failed (an error class name, or "HTTP <status>"), if it did. */
  error?: string;
};

/** An answer that is not a result: an HTTP error status. */
export function httpFailure(status: number): string | undefined {
  return status >= 400 ? `HTTP ${status}` : undefined;
}

/** A class name such as "TimeoutError", never an error's text. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

async function measure(port: number, target: Target, timeoutMs = 120_000): Promise<Measurement> {
  const markers = target.page ? pageMarkers(target.path) : null;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${target.path}`, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: target.page ? "text/html" : "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ttfbMs = ms();
    const seen: Record<string, number> = {};
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    const reader = res.body?.getReader();
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (markers) {
        html += decoder.decode(value, { stream: true });
        markSeen(html, markers, seen, ms());
      }
    }
    const failure = httpFailure(res.status);
    return {
      path: target.path,
      status: res.status,
      ttfbMs,
      completeMs: ms(),
      bytes,
      ...(markers ? { marks: seen } : {}),
      ...(failure ? { error: failure } : {}),
    };
  } catch (error) {
    return {
      path: target.path,
      status: 0,
      ttfbMs: -1,
      completeMs: ms(),
      bytes: 0,
      error: errorKind(error),
    };
  }
}

// ---- /api/status ----

export type Cost = {
  rpcPerHour: number;
  l1RpcPerHour: number;
  l2RpcPerHour: number;
  safePerHour: number;
  windowMs: number;
  mode?: string;
};

/** The parts of /api/status read here (everything optional: it is another process's answer). */
export type StatusLike = {
  ok?: boolean;
  governance?: { warnings?: unknown[]; network?: { label?: string; overrides?: unknown[] } };
  logHistory?: { status?: string };
  safeApi?: { withKey?: boolean; quota?: { limit?: number | null; remaining?: number | null } };
  sync?: {
    index?: { state?: string };
    l2Index?: { state?: string; governors?: unknown[] };
    cache?: { state?: string; file?: string | null; savedAt?: string | null; sizeBytes?: number };
    engine?: {
      mode?: string;
      active?: boolean;
      head?: { number?: string; observedAt?: string; servedAt?: string | null } | null;
      cost?: Cost;
    };
    safe?: {
      paused?: string | null;
      groups?: string[];
      budgetUsedThisHour?: number;
      baseline?: { safes: number; intervalMs: number } | null;
    };
  };
};

/**
 * Why the numbers must not be taken (AGENTS.md: stop and report): the status is not ok, the
 * contracts disagree, a trust anchor was replaced, proposal lists may be incomplete, or the log
 * history differs from the one the last run saved. Counts and states only.
 */
export function trustProblems(status: StatusLike): string[] {
  if (status.ok !== true) return ["/api/status is not ok"];
  const problems: string[] = [];
  const warnings = status.governance?.warnings?.length ?? 0;
  const overrides = status.governance?.network?.overrides?.length ?? 0;
  if (warnings > 0) problems.push(`governance.warnings has ${warnings} entries`);
  if (overrides > 0) problems.push(`governance.network.overrides has ${overrides} entries`);
  const history = status.logHistory?.status;
  if (history !== "ok") problems.push(`logHistory.status is ${history ?? "absent"}`);
  if (status.sync?.cache?.state === "mismatch") problems.push("sync.cache.state is mismatch");
  return problems;
}

/** What is printed of a status: states, counts and block numbers (no URL: not even Safe's). */
export function statusSummary(status: StatusLike) {
  const sync = status.sync;
  return {
    chain: status.governance?.network?.label ?? null,
    logHistory: status.logHistory?.status ?? null,
    safeApiKey: status.safeApi?.withKey ?? null,
    safeQuota: status.safeApi?.quota
      ? {
          remaining: status.safeApi.quota.remaining ?? null,
          limit: status.safeApi.quota.limit ?? null,
        }
      : null,
    index: sync?.index?.state ?? null,
    l2Index: sync?.l2Index?.state ?? null,
    cache: sync?.cache
      ? {
          state: sync.cache.state ?? null,
          file: sync.cache.file ?? null,
          savedAt: sync.cache.savedAt ?? null,
          sizeBytes: sync.cache.sizeBytes ?? null,
        }
      : null,
    engine: sync?.engine
      ? {
          mode: sync.engine.mode ?? null,
          active: sync.engine.active ?? null,
          head: sync.engine.head?.number ?? null,
          cost: pickCost(sync.engine.cost),
        }
      : null,
  };
}

/** Both log indexes have read their history (or have none to read). */
export function indexesSettled(status: StatusLike): boolean {
  const l2 = status.sync?.l2Index;
  const l2Settled =
    l2?.state === "ready" ||
    l2?.state === "unavailable" ||
    (l2?.state === "idle" && (l2.governors?.length ?? 0) === 0);
  return status.sync?.index?.state === "ready" && l2Settled;
}

/**
 * The engine's newest head when it is another than `previous`: its number, when the engine first
 * saw it and when it served it (null while not served yet), in ms since the epoch. null otherwise.
 */
export function newHead(
  status: StatusLike,
  previous: string | null
): { number: string; observedAt: number; servedAt: number | null } | null {
  const head = status.sync?.engine?.head;
  if (!head?.number || head.number === previous || !head.observedAt) return null;
  const observedAt = Date.parse(head.observedAt);
  if (Number.isNaN(observedAt)) return null;
  const servedAt = head.servedAt ? Date.parse(head.servedAt) : Number.NaN;
  return { number: head.number, observedAt, servedAt: Number.isNaN(servedAt) ? null : servedAt };
}

/**
 * Whether a request sent at `sentAt` for head `number` went out before the engine served that
 * head, from the engine's head read right after the answer (`after`): true when it was still not
 * served then, null when a newer head had already replaced it (unknown).
 */
export function servedState(
  after: ReturnType<typeof newHead>,
  number: string,
  sentAt: number
): { sentBeforeServed: boolean | null; servedAt: number | null } {
  if (after?.number !== number) return { sentBeforeServed: null, servedAt: null };
  if (after.servedAt === null) return { sentBeforeServed: true, servedAt: null };
  return { sentBeforeServed: sentAt < after.servedAt, servedAt: after.servedAt };
}

/** The slowest successful answer per path among `rows`, with the row's context. */
export function worstByPath(
  rows: readonly (Measurement & { context?: Record<string, unknown> })[]
): Record<string, { completeMs: number; context: Record<string, unknown> | null }> {
  const worst: Record<string, { completeMs: number; context: Record<string, unknown> | null }> = {};
  for (const row of rows) {
    if (row.error) continue;
    const known = worst[row.path];
    if (!known || row.completeMs > known.completeMs)
      worst[row.path] = { completeMs: row.completeMs, context: row.context ?? null };
  }
  return worst;
}

/** sync.engine.cost as printed: its counts only. */
export function pickCost(cost: Cost | undefined): Cost | null {
  if (!cost) return null;
  const { rpcPerHour, l1RpcPerHour, l2RpcPerHour, safePerHour, windowMs, mode } = cost;
  return { rpcPerHour, l1RpcPerHour, l2RpcPerHour, safePerHour, windowMs, mode };
}

/** sync.safe as printed: what the sweep does and spends (no error text). */
export function pickSafe(safe: NonNullable<StatusLike["sync"]>["safe"]) {
  if (!safe) return null;
  return {
    paused: safe.paused ?? null,
    groups: safe.groups ?? [],
    budgetUsedThisHour: safe.budgetUsedThisHour ?? null,
    baseline: safe.baseline ?? null,
  };
}

/**
 * Requests an hour sent between two readings of sync.engine.cost taken `elapsedMs` apart. The
 * counts are rolling one-hour sums, so the difference is exact only while the process is younger
 * than an hour (`exact`).
 */
export function costRate(before: Cost, after: Cost, elapsedMs: number) {
  const perHour = (a: number, b: number) =>
    elapsedMs > 0 ? Math.round(((b - a) * HOUR_MS) / elapsedMs) : 0;
  return {
    rpcPerHour: perHour(before.rpcPerHour, after.rpcPerHour),
    l1RpcPerHour: perHour(before.l1RpcPerHour, after.l1RpcPerHour),
    l2RpcPerHour: perHour(before.l2RpcPerHour, after.l2RpcPerHour),
    safePerHour: perHour(before.safePerHour, after.safePerHour),
    rpcRequests: after.rpcPerHour - before.rpcPerHour,
    safeRequests: after.safePerHour - before.safePerHour,
    minutes: Math.round(elapsedMs / 6_000) / 10,
    exact: after.windowMs < HOUR_MS,
  };
}

// ---- printing ----

/** A path as printed: a 32-byte id shortened to its first bytes. */
export function shortPath(path: string): string {
  return path.replace(/0x[0-9a-fA-F]{64}/g, (id) => `${id.slice(0, 6)}…`);
}

const fmt = (ms: number | undefined) => (ms === undefined ? "–" : ms.toLocaleString("en-US"));

export function formatRow(condition: string, m: Measurement): string {
  const head = `${condition.padEnd(9)} ${shortPath(m.path).padEnd(28)} ${String(m.status).padEnd(4)}`;
  if (m.error) return `${head} failed (${m.error}) after ${fmt(m.completeMs)} ms`;
  if (!m.marks) return `${head} complete ${fmt(m.completeMs)} ms`;
  const extra = Object.entries(m.marks)
    .filter(([name]) => !["shell", "core", "data"].includes(name))
    .map(([name, at]) => ` · ${name} ${fmt(at)}`)
    .join("");
  return `${head} ttfb ${fmt(m.ttfbMs)} · core ${fmt(m.marks.core)} · data ${fmt(m.marks.data)}${extra} · complete ${fmt(m.completeMs)} ms`;
}

// ---- servers ----

class StopError extends Error {
  override name = "StopError";
}

async function answers(port: number): Promise<boolean> {
  try {
    // A static file: served before the app, so it is not a visit for the sync engine.
    const res = await fetch(`http://127.0.0.1:${port}/favicon.ico`, {
      signal: AbortSignal.timeout(2_000),
    });
    await res.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/** One production server process on its own port, logging to its own file. */
class Server {
  readonly log: string;
  #child: ChildProcess | null = null;
  #exited: Promise<void> = Promise.resolve();
  /** When the last request to it (not counting /api/status reads) ended. */
  lastVisitAt = 0;

  constructor(
    readonly name: string,
    readonly port: number,
    readonly env: Record<string, string> = {}
  ) {
    this.log = join(LOGS, `${name}.log`);
  }

  /** Starts it and resolves once it answers, with the time that took. */
  async start(): Promise<number> {
    if (this.port === 3000) throw new StopError("Port 3000 is the preview's; use another --port.");
    if (await answers(this.port)) throw new StopError(`Port ${this.port} is already in use.`);
    const out = openSync(this.log, "w", 0o600);
    const started = performance.now();
    const child = spawn(process.execPath, ["./server-build/index.js"], {
      cwd: WEB,
      env: { ...process.env, NODE_ENV: "production", SERVER_PORT: String(this.port), ...this.env },
      stdio: ["ignore", out, out],
    });
    closeSync(out);
    this.#child = child;
    this.#exited = new Promise((resolve) => child.once("exit", () => resolve()));
    running.add(this);
    for (;;) {
      if (await answers(this.port)) return Math.round(performance.now() - started);
      if (
        child.exitCode !== null ||
        child.signalCode !== null ||
        performance.now() - started > 90_000
      ) {
        await this.stop();
        throw new StopError(
          `The ${this.name} server did not start; its log is ${relative(process.cwd(), this.log)}.`
        );
      }
      await sleep(25);
    }
  }

  /** Stops it gracefully (it saves the chain cache, bounded), then forcefully after 15 s. */
  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    running.delete(this);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const done = await Promise.race([this.#exited.then(() => true), sleep(15_000, false)]);
    if (!done) {
      child.kill("SIGKILL");
      await this.#exited;
    }
  }

  async status(): Promise<StatusLike> {
    const res = await fetch(`http://127.0.0.1:${this.port}/api/status`, {
      signal: AbortSignal.timeout(60_000),
    });
    return (await res.json()) as StatusLike;
  }

  /** Reads the status and stops the benchmark when it reports a trust problem. */
  async trusted(): Promise<StatusLike> {
    const status = await this.status();
    const problems = trustProblems(status);
    if (problems.length > 0)
      throw new StopError(`Stopped: ${problems.join("; ")} (${this.name} server).`);
    return status;
  }

  async request(target: Target): Promise<Measurement> {
    const m = await measure(this.port, target);
    this.lastVisitAt = Date.now();
    return m;
  }

  /**
   * Waits (bounded) until both log indexes have read their history, and stops the benchmark when
   * they have not: the numbers would then be taken from a server still reading it.
   */
  async settled(timeoutMs = 120_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (indexesSettled(await this.status())) return;
      await sleep(500);
    }
    throw new StopError(
      `Stopped: the ${this.name} server's log indexes did not finish reading their history within ${timeoutMs / 1000} s.`
    );
  }

  /** Reads every path once, to completion (pages: as a browser would, the whole stream). */
  async visitAll(): Promise<void> {
    for (const target of TARGETS) await this.request(target);
  }
}

const running = new Set<Server>();

async function stopAll() {
  stopping.abort(new StopError("The benchmark stopped."));
  await Promise.all([...running].map((server) => server.stop()));
}

// ---- the conditions ----

type Row = Measurement & { condition: Condition; context?: Record<string, unknown> };

class Results {
  rows: Row[] = [];
  notes: Record<string, unknown> = {};

  /** `label`: what is printed in place of the condition (e.g. "head+500"). */
  add(condition: Condition, m: Measurement, context?: Record<string, unknown>, label?: string) {
    this.rows.push({ condition, ...m, ...(context ? { context } : {}) });
    console.log(formatRow(label ?? condition, m));
  }
}

/** One fresh server per path: each path is the first request it gets, at liftoff. */
async function freshProcesses(
  condition: "fresh" | "cache",
  port: number,
  results: Results
): Promise<void> {
  for (const [i, target] of TARGETS.entries()) {
    const server = new Server(
      `${condition}-${i}`,
      port,
      condition === "fresh" ? { CHAIN_CACHE: "0" } : {}
    );
    const bootMs = await server.start();
    const m = await server.request(target);
    const status = await server.trusted();
    results.add(condition, m, { bootMs, cache: status.sync?.cache?.state ?? null });
    // With the cache: let the history be read in full first, so that the shutdown save keeps
    // all of it for the next process.
    if (condition === "cache") await server.settled();
    await server.stop();
  }
}

// The JSON detail endpoints: those a new block can make slow (their signature sets are verified
// again at it).
const HEAD_SWEEP: readonly Target[] = TARGETS.filter(
  (t) => !t.page && /0x[0-9a-fA-F]{64}$/.test(t.path)
);

/**
 * The engine running: every path read once, then each again; then right after new blocks (see
 * "head" above). Every measurement is followed by a trust check.
 */
async function warmAndHead(
  conditions: ReadonlySet<Condition>,
  port: number,
  results: Results
): Promise<void> {
  const server = new Server("warm", port);
  await server.start();
  await server.settled();
  await server.trusted();
  await server.visitAll();
  await sleep(2_000);
  const before = (await server.status()).sync?.engine?.cost;
  const since = Date.now();
  if (conditions.has("warm"))
    for (const target of TARGETS) {
      results.add("warm", await server.request(target));
      await server.trusted();
    }
  if (conditions.has("head")) {
    let last = (await server.status()).sync?.engine?.head?.number ?? null;
    // As soon as the engine serves a new head.
    for (const target of TARGETS) {
      const head = await waitForHead(server, last, true);
      last = head.number;
      const sentAt = Date.now();
      const m = await server.request(target);
      await server.trusted();
      results.add("head", m, {
        head: head.number,
        sinceObservedMs: sentAt - head.observedAt,
        sinceServedMs: head.servedAt === null ? null : sentAt - head.servedAt,
      });
    }
    // At set times after the engine first saw a new head, served or not yet.
    for (const target of HEAD_SWEEP)
      for (const offsetMs of HEAD_OFFSETS_MS) {
        const head = await waitForHead(server, last, false);
        last = head.number;
        await sleep(Math.max(0, head.observedAt + offsetMs - Date.now()));
        const sentAt = Date.now();
        const m = await server.request(target);
        const served = servedState(newHead(await server.trusted(), null), head.number, sentAt);
        results.add(
          "head",
          m,
          {
            head: head.number,
            offsetMs,
            sinceObservedMs: sentAt - head.observedAt,
            ...served,
            servedAfterObservedMs:
              served.servedAt === null ? null : served.servedAt - head.observedAt,
          },
          `head+${offsetMs}`
        );
      }
    results.notes.headWorst = worstByPath(results.rows.filter((row) => row.condition === "head"));
  }
  const after = (await server.trusted()).sync?.engine?.cost;
  if (before && after)
    results.notes.viewingCost = {
      ...costRate(before, after, Date.now() - since),
      mode: after.mode,
    };
  await server.stop();
}

/**
 * Waits for the engine to see a head other than `previous` (with `served`: and to serve it), and
 * returns it. Stops the benchmark when none comes within a minute.
 */
async function waitForHead(
  server: Server,
  previous: string | null,
  served: boolean,
  timeoutMs = 60_000
): Promise<{ number: string; observedAt: number; servedAt: number | null }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const head = newHead(await server.status(), previous);
    if (head && (!served || head.servedAt !== null)) return head;
    await sleep(25);
  }
  throw new StopError(
    `Stopped: the ${server.name} server's engine saw no new head within a minute.`
  );
}

/**
 * Safe copies older than 60 s while in use (sweeps off), and the engine idle: each path is
 * measured after STALE_WAIT_MS without requests to that server. Beside them, for 10 minutes after
 * one visit of every path, one server is left alone ("cost") and another gets one page a minute
 * ("use"); the sync.engine.cost of each is read before and after.
 */
async function staleAndIdle(
  conditions: ReadonlySet<Condition>,
  port: number,
  results: Results
): Promise<void> {
  // Settle with the cost readings' failure (or null), so that a failure while the other servers
  // are measured is reported at the end rather than as an unhandled rejection.
  let cost: Promise<unknown> = Promise.resolve(null);
  let use: Promise<unknown> = Promise.resolve(null);
  if (conditions.has("use")) {
    const server = new Server("use", port + 4);
    await server.start();
    await server.settled();
    await server.trusted();
    await server.visitAll();
    await sleep(5_000);
    const before = await server.trusted();
    const since = Date.now();
    console.log(
      `use       one page a minute for ${COST_IDLE_MS / 60_000} minutes from now (${before.sync?.engine?.cost?.mode ?? "?"})`
    );
    use = (async () => {
      for (let minute = 0; minute < COST_IDLE_MS / IN_USE_EVERY_MS; minute++) {
        await sleep(IN_USE_EVERY_MS, undefined, { signal: stopping.signal });
        const m = await server.request({ path: IN_USE_PATH, page: true });
        if (m.error)
          throw new StopError(`Stopped: ${IN_USE_PATH} failed (${m.error}) on the use server.`);
      }
      const after = await server.trusted();
      const b = before.sync?.engine?.cost;
      const a = after.sync?.engine?.cost;
      results.notes.inUseCost = {
        before: pickCost(b),
        after: pickCost(a),
        rate: b && a ? costRate(b, a, Date.now() - since) : null,
        safe: pickSafe(after.sync?.safe),
      };
      console.log(
        `use       after ${COST_IDLE_MS / 60_000} minutes in use: ${JSON.stringify(results.notes.inUseCost)}`
      );
      await server.stop();
    })().then(
      () => null,
      (error: unknown) => error
    );
  }
  if (conditions.has("cost")) {
    const server = new Server("cost", port + 1, { SYNC_KEEPWARM_MS: String(IDLE_KEEPWARM_MS) });
    await server.start();
    await server.settled();
    await server.trusted();
    await server.visitAll();
    // Past the keep-warm window, and past the work the visits left behind.
    await sleep(STALE_WAIT_MS, undefined, { signal: stopping.signal });
    const before = await server.trusted();
    const since = Date.now();
    console.log(
      `cost      idle for ${COST_IDLE_MS / 60_000} minutes from now (${before.sync?.engine?.cost?.mode ?? "?"})`
    );
    cost = (async () => {
      await sleep(COST_IDLE_MS, undefined, { signal: stopping.signal });
      const after = await server.trusted();
      const b = before.sync?.engine?.cost;
      const a = after.sync?.engine?.cost;
      results.notes.idleCost = {
        before: pickCost(b),
        after: pickCost(a),
        rate: b && a ? costRate(b, a, Date.now() - since) : null,
        safe: pickSafe(after.sync?.safe),
      };
      console.log(
        `cost      after ${COST_IDLE_MS / 60_000} idle minutes: ${JSON.stringify(results.notes.idleCost)}`
      );
      await server.stop();
    })().then(
      () => null,
      (error: unknown) => error
    );
  }
  const servers: [Condition, Server][] = [];
  if (conditions.has("safe"))
    servers.push(["safe", new Server("safe", port + 2, { SYNC_SAFE_HOURLY_BUDGET: "0" })]);
  if (conditions.has("idle"))
    servers.push([
      "idle",
      new Server("idle", port + 3, { SYNC_KEEPWARM_MS: String(IDLE_KEEPWARM_MS) }),
    ]);
  for (const [, server] of servers) {
    await server.start();
    await server.settled();
    await server.trusted();
    await server.visitAll();
  }
  for (const target of TARGETS) {
    for (const [condition, server] of servers) {
      await sleep(Math.max(0, server.lastVisitAt + STALE_WAIT_MS - Date.now()));
      // The trust check between two measurements (reading the status is not a visit).
      const engine = (await server.trusted()).sync?.engine;
      const m = await server.request(target);
      results.add(condition, m, { engineMode: engine?.cost?.mode ?? null });
    }
  }
  for (const [, server] of servers) {
    await server.trusted();
    await server.stop();
  }
  for (const task of [cost, use]) {
    const failed = await task;
    if (failed) throw failed;
  }
}

// ---- main ----

function parseArgs(argv: string[]): { conditions: Set<Condition>; port: number } {
  let conditions = new Set<Condition>(CONDITIONS);
  let port = 3105;
  for (const arg of argv) {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    if (key === "only") {
      const wanted = value.split(",").filter(Boolean);
      const unknown = wanted.filter((c) => !(CONDITIONS as readonly string[]).includes(c));
      if (unknown.length > 0) throw new StopError(`Unknown condition(s): ${unknown.join(", ")}`);
      conditions = new Set(wanted as Condition[]);
    } else if (key === "port") {
      port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65_000)
        throw new StopError("--port must be a port number above 1023");
    } else {
      throw new StopError(`Unknown argument ${arg}`);
    }
  }
  return { conditions, port };
}

async function main() {
  const { conditions, port } = parseArgs(process.argv.slice(2));
  if (!existsSync(join(WEB, "server-build/index.js")) || !existsSync(join(WEB, "build/server")))
    throw new StopError("No production build: run `corepack pnpm --filter web build` first.");
  mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  const results = new Results();
  const startedAt = new Date().toISOString();

  // The trust check, and the chain cache the "cache" condition starts from: one server reads the
  // whole history and saves it when it stops.
  const gate = new Server("gate", port);
  await gate.start();
  await gate.settled();
  const trusted = await gate.trusted();
  results.notes.status = statusSummary(trusted);
  console.log(`status ${JSON.stringify(results.notes.status)}`);
  await gate.stop();

  if (conditions.has("fresh")) await freshProcesses("fresh", port, results);
  if (conditions.has("cache")) await freshProcesses("cache", port, results);
  if (conditions.has("warm") || conditions.has("head"))
    await warmAndHead(conditions, port, results);
  if (["safe", "idle", "cost", "use"].some((c) => conditions.has(c as Condition)))
    await staleAndIdle(conditions, port, results);

  const file = join(OUT, "benchmark-sync.json");
  await writeFile(
    file,
    `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), notes: results.notes, rows: results.rows }, null, 2)}\n`
  );
  console.log(`results ${relative(process.cwd(), file)}`);
}

/** An error's first line with anything URL-like removed (the servers' errors never reach here). */
export function scrubbed(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split("\n")[0] ?? "").replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "<url>");
}

/** Run as a script (not imported, e.g. by its tests). */
function invokedDirectly(): boolean {
  try {
    const script = process.argv[1];
    return !!script && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const stop = () => void stopAll().finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof StopError
        ? error.message
        : `Failed (${errorKind(error)}): ${scrubbed(error)}`
    );
    process.exitCode = 1;
  } finally {
    await stopAll();
  }
}
