// Read-only benchmark of the request system (docs/performance-improvements.md): what the app sends
// upstream (L1 and ZKsync Era JSON-RPC, Safe) by method and step, per block and per hour, and how
// long JSON and pages take after a pause, warm and right after a new block. Each condition runs on
// a production server of its own, traced by upstream-trace.mjs, with pages kept on screen by a
// Playwright browser (packages/e2e) whose tabs beat as a viewer's do:
//   json     an AGENTS.md JSON session, 10 quiet minutes, and the JSON again 1 h later, then warm
//   upgrade  the upgrade page 0x77d5… visible for 20 minutes
//   idle     60 minutes unused after the six pages were shown (chain cache on), then the six pages
//   pages    the upgrade and emergency upgrade 0xb166… pages for 15 minutes (hidden: those tabs
//            hidden for 3 minutes, then visible for 2; and a tab hidden from its load)
//   resume   after use ends, the chain-only JSON and the six pages after 90 s and after 10 minutes
//   home     `/` visible for 10 minutes (veto: the veto list, ZKsync Era)
//   open     an open signature set's page (--open) for 10 minutes, then "Fetch signatures"
//            (keyless: the same without a Safe API key)
//   warm     every path while a page is visible (head: right after new heads, at HEAD_OFFSETS_MS)
//   restart  a new process with the idle server's chain cache: the six pages at liftoff, then JSON
//   fresh    (not by default) one fresh server per path (cache: with the chain cache)
// It only GETs from its own servers (--port and the five above; never 3000 or 3001) and prints
// timings, counts and states: never an RPC URL, key or server log (.cache/local/benchmark-sync/).
// It stops when /api/status reports governance warnings, network overrides, a log history that is
// not "ok" or a chain cache mismatch, checked at each server's start, after each window in use,
// after the first request of each JSON pair and at each condition's end (never in idle windows,
// where the read would itself go upstream). An HTTP error status is a failure, never a timing.
//
// From apps/web, after `corepack pnpm --filter web build`:
//   PW_CHANNEL=chrome corepack pnpm exec tsx test/support/benchmark-sync.ts
//     [--only=json,upgrade,...] [--port=3105] [--scale=0.1] [--open=/app/emergency/0x…]
// --scale multiplies every window and pause. Results: .cache/local/benchmark-sync.json at the
// repository's root. A full run takes about 85 minutes.
import { type ChildProcess, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toFunctionSelector } from "viem";
import { creditsOf } from "../../app/.server/sync/pacer";
import { EMERGENCY_ID, UPGRADE_ID } from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "../..");
const OUT = resolve(WEB, "../../.cache/local");
const LOGS = join(OUT, "benchmark-sync");
const TRACER = join(HERE, "upstream-trace.mjs");
const HOUR_MS = 3_600_000;
const MINUTE = 60_000;
// Bots get pages rendered in full; a browser's user agent gets the streamed page.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
/** How long the app counts a page load or beat as use (SYNC_KEEPWARM_MS's default), plus a wake. */
const KEEPWARM_MS = 30_000 + 5_000;
/** A pending emergency upgrade on mainnet on October 8 (open signature sets). */
const OPEN_PATH =
  "/app/emergency/0x4fa238865a64c1ccc992bfc0a4e984d13443e0e87c67feddb3cedc6f20f59f59";
export const HEAD_OFFSETS_MS = [0, 250, 500, 750, 1_000, 1_500] as const;
const stopping = new AbortController();

class StopError extends Error {
  override name = "StopError";
}

export const CONDITIONS = [
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
  "warm",
  "head",
  "restart",
  "fresh",
  "cache",
] as const;
export type Condition = (typeof CONDITIONS)[number];
export const DEFAULT_CONDITIONS: readonly Condition[] = CONDITIONS.filter(
  (c) => c !== "fresh" && c !== "cache"
);

export type Target = { path: string; page: boolean };
const jsonTargets = (...paths: string[]): readonly Target[] =>
  paths.map((path) => ({ path, page: false }));

export const TARGETS: readonly Target[] = [
  ...jsonTargets(
    "/api/status",
    "/api/upgrades",
    "/api/upgrades?history=all",
    `/api/upgrades/${UPGRADE_ID}`,
    "/api/emergency",
    `/api/emergency/${EMERGENCY_ID}`,
    "/api/vetoes",
    "/api/freeze"
  ),
  ...[
    "/",
    "/app/proposals",
    `/app/proposals/${UPGRADE_ID}`,
    "/app/emergency",
    `/app/emergency/${EMERGENCY_ID}`,
    "/app/l2-cancellations",
  ].map((path) => ({ path, page: true })),
];
export const PAGES: readonly Target[] = TARGETS.filter((t) => t.page);
/** The JSON a resume is measured on: chain-only endpoints (no Safe), acceptance target 4. */
export const RESUME_JSON = jsonTargets("/api/status", "/api/upgrades", "/api/upgrades?history=all");
export const AGENT_SESSION = jsonTargets(
  "/api/status",
  "/api/upgrades",
  `/api/upgrades/${UPGRADE_ID}`,
  `/api/emergency/${EMERGENCY_ID}`,
  "/api/status"
);

// ---- pages: what the streamed HTML shows, and when ----

export type Markers = Record<string, readonly string[]>;

const SHELL = ['aria-label="Governance navigation"'];
// Shown before it is current, labelled as older or unconfirmed (components/verification/*).
const LABELLED = [
  'data-stale="true"',
  'data-testid="set-stale"',
  'data-testid="summary-note"',
  'data-testid="last-run"',
  'data-testid="last-run-check"',
  'data-testid="as-of"',
];

/** The markers of a page's streamed HTML: shell, core (main section), data, its own, labelled. */
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

/** A page's first flush: what arrived within this long of its first bytes (acceptance target 5). */
export const FIRST_FLUSH_MS = 50;

export type Measurement = {
  path: string;
  status: number;
  ttfbMs: number;
  completeMs: number;
  bytes: number;
  marks?: Record<string, number>;
  firstFlush?: FirstFlush;
  /** An error class name, or "HTTP <status>". */
  error?: string;
};

export type FirstFlush = { byMs: number; marks: string[] };

/** The markers a page showed by FIRST_FLUSH_MS after its first bytes, in the order they came. */
export function firstFlushOf(ttfbMs: number, marks: Record<string, number>): FirstFlush {
  const byMs = ttfbMs + FIRST_FLUSH_MS;
  return {
    byMs,
    marks: Object.entries(marks)
      .filter(([, at]) => at <= byMs)
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name),
  };
}

/** Acceptance target 5: first bytes in time, and the main data, or a label, in the first flush. */
export function dataInFirstFlush(m: Measurement): boolean {
  if (m.error || m.ttfbMs < 0 || m.ttfbMs >= FIRST_FLUSH_MS) return false;
  const shown = (m.firstFlush ?? firstFlushOf(m.ttfbMs, m.marks ?? {})).marks;
  return shown.includes("data") || shown.includes("labelled");
}

export function httpFailure(status: number): string | undefined {
  return status >= 400 ? `HTTP ${status}` : undefined;
}

/** A class name such as "TimeoutError", never an error's text. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z]\w{0,63}$/.test(name) ? name : "Error";
}

async function measure(port: number, target: Target): Promise<Measurement> {
  const markers = target.page ? pageMarkers(target.path) : null;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${target.path}`, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: target.page ? "text/html" : "application/json",
      },
      signal: AbortSignal.timeout(120_000),
    });
    const ttfbMs = ms();
    const seen: Record<string, number> = {};
    const decoder = new TextDecoder();
    const reader = res.body?.getReader();
    let html = "";
    let bytes = 0;
    while (reader) {
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
      ...(markers ? { marks: seen, firstFlush: firstFlushOf(ttfbMs, seen) } : {}),
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
  infuraCreditsPerHour?: number;
  windowMs: number;
  mode?: string;
  pacer?: { peakPerSecond?: number; waited?: number };
};

/** The parts of /api/status read here (all optional: another process's answer). */
export type StatusLike = {
  ok?: boolean;
  governance?: { warnings?: unknown[]; network?: { label?: string; overrides?: unknown[] } };
  logHistory?: { status?: string };
  safeApi?: { withKey?: boolean; quota?: { limit?: number | null; remaining?: number | null } };
  sync?: {
    index?: { state?: string };
    l2Index?: { state?: string; governors?: unknown[] };
    cache?: { state?: string; file?: string | null; savedAt?: string | null; sizeBytes?: number };
    presence?: { inUse?: boolean; tabs?: number; keys?: number };
    engine?: {
      mode?: string;
      active?: boolean;
      head?: { number?: string; observedAt?: string; servedAt?: string | null } | null;
      lastTick?: { failedSteps?: string[] } | null;
      cost?: Cost;
      clock?: {
        recent?: {
          pollsPerBlock?: number | null;
          servedDelayMs?: { p50: number; p80: number; max: number } | null;
        };
      };
    };
    safe?: {
      paused?: string | null;
      budgetUsedThisHour?: number;
      watched?: {
        safes?: number;
        lists?: number;
        keyless?: boolean;
        effectiveCadenceMs?: Record<string, number | null>;
        allowancePerHour?: number;
      } | null;
    };
    signatures?: { onScreen?: number; open?: number };
    l2?: { onScreen?: number; eraBlock?: string | null };
  };
};

/** AGENTS.md's stop-and-report conditions, as counts and states. */
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

/** What the engine and its watchers report at the end of a window (counts and states only). */
export function engineSummary(status: StatusLike) {
  const sync = status.sync;
  const engine = sync?.engine;
  const watched = sync?.safe?.watched;
  return {
    active: engine?.active ?? null,
    inUse: sync?.presence?.inUse ?? null,
    tabs: sync?.presence?.tabs ?? null,
    keys: sync?.presence?.keys ?? null,
    pollsPerBlock: engine?.clock?.recent?.pollsPerBlock ?? null,
    servedDelayMs: engine?.clock?.recent?.servedDelayMs ?? null,
    failedSteps: engine?.lastTick?.failedSteps ?? [],
    enginePeakCreditsPerSecond: engine?.cost?.pacer?.peakPerSecond ?? null,
    pacerWaited: engine?.cost?.pacer?.waited ?? null,
    signatures: sync?.signatures
      ? { onScreen: sync.signatures.onScreen ?? null, open: sync.signatures.open ?? null }
      : null,
    safe: sync?.safe
      ? {
          paused: sync.safe.paused ?? null,
          budgetUsedThisHour: sync.safe.budgetUsedThisHour ?? null,
          watched: watched
            ? {
                safes: watched.safes ?? null,
                lists: watched.lists ?? null,
                keyless: watched.keyless ?? null,
                effectiveCadenceMs: watched.effectiveCadenceMs ?? null,
                allowancePerHour: watched.allowancePerHour ?? null,
              }
            : null,
        }
      : null,
    era: sync?.l2 ? { onScreen: sync.l2.onScreen ?? null, block: sync.l2.eraBlock ?? null } : null,
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

/** The engine's head unless it is `previous`: its number, when it was seen and served (or null). */
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

/** Whether a request sent at `sentAt` preceded the head's serving (null: a newer head came). */
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
  return {
    rpcPerHour,
    l1RpcPerHour,
    l2RpcPerHour,
    safePerHour,
    ...(cost.infuraCreditsPerHour === undefined
      ? {}
      : { infuraCreditsPerHour: cost.infuraCreditsPerHour }),
    windowMs,
    mode,
  };
}

// ---- what a server sent upstream (upstream-trace.mjs) ----

export type TraceCall = {
  m: string;
  /** eth_call: the 4-byte selector, or for Multicall3's aggregate3 its number of sub-calls. */
  sel?: string;
  mc?: number;
  /** A block number, "latest", "finalized", "hash", … */
  tag?: string | number | null;
  /** eth_getLogs by number: blocks covered. */
  span?: number;
};

// A request is in the window it was sent in (`inFlight`: unanswered at its dump); an `answer`
// came for one in a later window: counted with that window's errors, never as a request.
export type TraceEvent =
  | {
      kind: "rpc";
      at: number;
      ms?: number;
      host: string;
      hint?: "era";
      calls: TraceCall[];
      status?: number;
      errors?: Record<string, number>;
      failed?: string;
      inFlight?: true;
    }
  | {
      kind: "safe";
      at: number;
      ms?: number;
      what: string;
      safe: string | null;
      status?: number;
      failed?: string;
      inFlight?: true;
    }
  | { kind: "head"; at: number; host: string; number: number }
  | { kind: "other"; at: number; inFlight?: true }
  | {
      kind: "answer";
      at: number;
      of: "rpc" | "safe" | "other";
      sentAt: number;
      host?: string;
      ms?: number;
      status?: number;
      failed?: string;
      errors?: Record<string, number>;
    };

export type Trace = { dumpedAt?: number; chains: Record<string, number>; events: TraceEvent[] };

// ZKsync Era mainnet, Era Sepolia, and local Era nodes.
const ERA_CHAINS = new Set([324, 300, 260, 270]);

/** A host's RPC: by its chain id; else Era if named so or another host is L1; else unknown. */
export function chainOf(
  trace: Pick<Trace, "chains">,
  host: string,
  hint?: "era"
): "l1" | "era" | "unknown" {
  const id = trace.chains[host];
  if (id !== undefined) return ERA_CHAINS.has(id) ? "era" : "l1";
  if (hint === "era") return "era";
  const knowsL1 = Object.values(trace.chains).some((chain) => !ERA_CHAINS.has(chain));
  return knowsL1 ? "era" : "unknown";
}

const VERDICT_SELECTORS = new Set<string>(
  [
    "checkSignatures(bytes32,address[],bytes[],uint256)",
    "isValidSignature(bytes32,bytes)",
    "isValidSignature(bytes,bytes)",
    "signedMessages(bytes32)",
  ].map((signature) => toFunctionSelector(signature))
);
// Governance's member lists end where members(i) reverts, read directly.
const MEMBERS_SELECTOR: string = toFunctionSelector("members(uint256)");
// The backfill reads ranges this long or longer (Infura's eth_getLogs cap).
const BACKFILL_SPAN = 10_000;

/** What a JSON-RPC entry is for, by method, block tag and selector. */
export function stepOf(chain: "l1" | "era" | "unknown", call: TraceCall): string {
  const { m } = call;
  if (chain === "era") {
    if (m === "eth_blockNumber" || (m === "eth_getBlockByNumber" && typeof call.tag === "string"))
      return "Era head";
    if (m === "eth_getLogs")
      return (call.span ?? 0) >= BACKFILL_SPAN ? "Era history backfill" : "Era index tail";
    if (m === "eth_call") return "Era calls";
    if (m.startsWith("zks_")) return "Era batch";
    return `Era ${m}`;
  }
  if (m === "eth_blockNumber") return "head poll";
  if (m === "eth_getBlockByNumber") {
    if (call.tag === "latest") return "head poll";
    if (call.tag === "finalized") return "head poll (finalized)";
    return "block by number";
  }
  if (m === "eth_getLogs") {
    if (call.tag === "hash") return "logs by hash";
    if (call.span === undefined) return "logs (tagged range)";
    if (call.span <= 1) return "log-history canary";
    return call.span >= BACKFILL_SPAN ? "history backfill" : "index tail";
  }
  if (m === "eth_call") {
    if (call.mc !== undefined) return "aggregate3";
    if (call.sel && VERDICT_SELECTORS.has(call.sel)) return "verdict (direct)";
    return call.sel === MEMBERS_SELECTOR ? "governance members (direct)" : "eth_call (direct)";
  }
  if (m === "eth_getCode") return "code";
  if (m === "eth_chainId" || m === "web3_clientVersion" || m === "net_version") return "network";
  if (m === "eth_getTransactionByHash" || m === "eth_getTransactionReceipt") return "transaction";
  return m;
}

/** A method as counted: eth_call split into aggregate3 and direct, block reads by their tag. */
export function methodOf(call: TraceCall): string {
  if (call.m === "eth_call") return call.mc !== undefined ? "eth_call(aggregate3)" : "eth_call";
  if (call.m === "eth_getBlockByNumber")
    return `eth_getBlockByNumber(${typeof call.tag === "string" ? call.tag : "number"})`;
  return call.m;
}

/** The most Infura credits sent in any one second (sliding), from send times. */
export function peakCreditsPerSecond(sent: readonly { at: number; credits: number }[]): number {
  const sorted = [...sent].sort((a, b) => a.at - b.at);
  let peak = 0;
  let sum = 0;
  let start = 0;
  for (const item of sorted) {
    sum += item.credits;
    while (start < sorted.length && (sorted[start]?.at ?? 0) <= item.at - 1_000) {
      sum -= sorted[start]?.credits ?? 0;
      start++;
    }
    peak = Math.max(peak, sum);
  }
  return peak;
}

export type Count = { n: number; perBlock: number | null; perHour: number };

export type ChainSummary = {
  /** HTTP POSTs; `requests` counts each batch entry, as providers bill them. */
  posts: number;
  requests: number;
  perBlock: number | null;
  perHour: number;
  perMinute: number;
  /** At Infura's credit weights (an estimate for other providers). */
  credits: number;
  creditsPerBlock: number | null;
  creditsPerHour: number;
  peakCreditsPerSecond: number;
  byMethod: Record<string, Count>;
  byStep: Record<string, Count>;
  aggregate3SubCalls: { min: number; max: number } | null;
  /** JSON-RPC error codes of failed entries; HTTP statuses other than 200 and failed POSTs. */
  errors: Record<string, number>;
  httpErrors: Record<string, number>;
};

export type SafeSummary = {
  requests: number;
  perHour: number;
  byKind: Record<string, number>;
  /** Per Safe: requests, their kinds in order (c check, l listing, m message, i info), gaps (s). */
  perSafe: Record<string, { n: number; kinds: string; gapsS: number[] }>;
  httpErrors: Record<string, number>;
};

export type WindowSummary = {
  seconds: number;
  /** L1 blocks that arrived in the window (newest head polled minus the oldest), or null. */
  blocks: number | null;
  l1: ChainSummary;
  era: ChainSummary;
  /** RPC requests to a host that never answered eth_chainId (should be 0). */
  unknownRpc: number;
  safe: SafeSummary;
  other: number;
  /** Requests sent in the window and not answered when it ended. */
  inFlight: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const perHourOf = (n: number, windowMs: number) =>
  windowMs > 0 ? Math.round(n / (windowMs / HOUR_MS)) : 0;
const bump = (counts: Record<string, number>, key: string, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};
const ofKind = <K extends TraceEvent["kind"]>(events: readonly TraceEvent[], kind: K) =>
  events.filter((e): e is Extract<TraceEvent, { kind: K }> => e.kind === kind);

/** An upstream answer's HTTP failure (a failed POST, a status other than 200), or null. */
const upstreamFailure = (event: { failed?: string; status?: number }) =>
  event.failed ??
  (event.status !== undefined && event.status !== 200 ? String(event.status) : null);

function chainSummary(
  events: readonly Extract<TraceEvent, { kind: "rpc" }>[],
  late: readonly Extract<TraceEvent, { kind: "answer" }>[],
  chain: "l1" | "era",
  windowMs: number,
  blocks: number | null
): ChainSummary {
  const count = (n: number): Count => ({
    n,
    perBlock: blocks ? round2(n / blocks) : null,
    perHour: perHourOf(n, windowMs),
  });
  const methods: Record<string, number> = {};
  const steps: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const httpErrors: Record<string, number> = {};
  const sizes: number[] = [];
  const sent: { at: number; credits: number }[] = [];
  let requests = 0;
  let credits = 0;
  for (const event of events) {
    let eventCredits = 0;
    for (const call of event.calls) {
      requests++;
      eventCredits += creditsOf(call.m);
      bump(methods, methodOf(call));
      bump(steps, stepOf(chain, call));
      if (call.mc !== undefined) sizes.push(call.mc);
    }
    credits += eventCredits;
    sent.push({ at: event.at, credits: eventCredits });
  }
  // Answers to requests of an earlier window add their errors, never requests.
  for (const answered of [...events, ...late]) {
    for (const [code, n] of Object.entries(answered.errors ?? {})) bump(errors, code, n);
    const http = upstreamFailure(answered);
    if (http) bump(httpErrors, http);
  }
  const map = (counts: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => [name, count(n)])
    );
  return {
    posts: events.length,
    requests,
    perBlock: blocks ? round2(requests / blocks) : null,
    perHour: perHourOf(requests, windowMs),
    perMinute: windowMs > 0 ? round2(requests / (windowMs / MINUTE)) : 0,
    credits,
    creditsPerBlock: blocks ? Math.round(credits / blocks) : null,
    creditsPerHour: perHourOf(credits, windowMs),
    peakCreditsPerSecond: peakCreditsPerSecond(sent),
    byMethod: map(methods),
    byStep: map(steps),
    aggregate3SubCalls:
      sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
    errors,
    httpErrors,
  };
}

/** What one window of a trace sent upstream, per chain, per block and per hour. */
export function summarizeTrace(trace: Trace, windowMs: number): WindowSummary {
  const rpc = ofKind(trace.events, "rpc");
  const hints = new Map(rpc.filter((e) => e.hint).map((e) => [e.host, e.hint]));
  const chainOfHost = (host: string) => chainOf(trace, host, hints.get(host));
  const l1Heads = ofKind(trace.events, "head")
    .filter((e) => chainOfHost(e.host) === "l1")
    .map((e) => e.number);
  const blocks = l1Heads.length > 1 ? Math.max(...l1Heads) - Math.min(...l1Heads) : 0;
  const answers = ofKind(trace.events, "answer");
  const perChain = (chain: "l1" | "era") =>
    chainSummary(
      rpc.filter((e) => chainOf(trace, e.host, e.hint) === chain),
      answers.filter(
        (a) => a.of === "rpc" && a.host !== undefined && chainOfHost(a.host) === chain
      ),
      chain,
      windowMs,
      blocks > 0 ? blocks : null
    );
  const safeEvents = ofKind(trace.events, "safe");
  const byKind: Record<string, number> = {};
  const httpErrors: Record<string, number> = {};
  const bySafe: Record<string, { at: number; what: string }[]> = {};
  for (const answered of [...answers.filter((a) => a.of === "safe"), ...safeEvents]) {
    const http = upstreamFailure(answered);
    if (http) bump(httpErrors, http);
  }
  for (const event of safeEvents) {
    bump(byKind, event.what);
    const safe = event.safe ?? "?";
    bySafe[safe] = [...(bySafe[safe] ?? []), { at: event.at, what: event.what }];
  }
  const perSafe = Object.fromEntries(
    Object.entries(bySafe).map(([safe, list]) => {
      const sorted = [...list].sort((a, b) => a.at - b.at);
      return [
        safe,
        {
          n: sorted.length,
          kinds: sorted.map((e) => e.what[0] ?? "?").join(""),
          gapsS: sorted
            .slice(1)
            .map((e, i) => Math.round((e.at - (sorted[i]?.at ?? e.at)) / 1_000)),
        },
      ];
    })
  );
  return {
    seconds: Math.round(windowMs / 1_000),
    blocks: blocks > 0 ? blocks : null,
    l1: perChain("l1"),
    era: perChain("era"),
    unknownRpc: rpc
      .filter((e) => chainOf(trace, e.host, e.hint) === "unknown")
      .reduce((n, e) => n + e.calls.length, 0),
    safe: {
      requests: safeEvents.length,
      perHour: perHourOf(safeEvents.length, windowMs),
      byKind,
      perSafe,
      httpErrors,
    },
    other: trace.events.filter((e) => e.kind === "other").length,
    inFlight: trace.events.filter((e) => "inFlight" in e && e.inFlight === true).length,
  };
}

export function silent(w: WindowSummary): boolean {
  return (
    w.l1.requests === 0 &&
    w.era.requests === 0 &&
    w.safe.requests === 0 &&
    w.unknownRpc === 0 &&
    w.other === 0
  );
}

// ---- printing ----

export function shortPath(path: string): string {
  return path.replace(/0x[0-9a-fA-F]{64}/g, (id) => `${id.slice(0, 6)}…`);
}

const fmt = (ms: number | undefined | null) =>
  ms === undefined || ms === null ? "–" : ms.toLocaleString("en-US");

export function formatRow(condition: string, m: Measurement): string {
  const head = `${condition.padEnd(18)} ${shortPath(m.path).padEnd(28)} ${String(m.status).padEnd(4)}`;
  if (m.error) return `${head} failed (${m.error}) after ${fmt(m.completeMs)} ms`;
  if (!m.marks) return `${head} complete ${fmt(m.completeMs)} ms`;
  const extra = Object.entries(m.marks)
    .filter(([name]) => !["shell", "core", "data"].includes(name))
    .map(([name, at]) => ` · ${name} ${fmt(at)}`)
    .join("");
  return `${head} ttfb ${fmt(m.ttfbMs)} · core ${fmt(m.marks.core)} · data ${fmt(m.marks.data)}${extra} · complete ${fmt(m.completeMs)} ms`;
}

/** One line per window: blocks, L1 per block and hour with the main steps, credits, Era, Safe. */
export function formatWindow(label: string, w: WindowSummary): string {
  const minutes = round2(w.seconds / 60);
  const per = (c: Count) => (c.perBlock === null ? `${c.n}` : `${c.perBlock}`);
  const steps = Object.entries(w.l1.byStep)
    .slice(0, 6)
    .map(([step, c]) => `${step} ${per(c)}`)
    .join(", ");
  const l1 =
    w.l1.requests === 0
      ? "L1 0"
      : `L1 ${w.l1.perBlock ?? w.l1.requests}${w.l1.perBlock === null ? "" : "/block"} (${fmt(w.l1.perHour)}/h; ${steps}) · ${fmt(w.l1.creditsPerBlock ?? w.l1.credits)} credits${w.l1.creditsPerBlock === null ? "" : "/block"} (${fmt(w.l1.creditsPerHour)}/h, peak ${fmt(w.l1.peakCreditsPerSecond)}/s)`;
  const era = w.era.requests === 0 ? "Era 0" : `Era ${w.era.requests} (${fmt(w.era.perHour)}/h)`;
  const safe =
    w.safe.requests === 0
      ? "Safe 0"
      : `Safe ${w.safe.requests} (${fmt(w.safe.perHour)}/h; ${Object.entries(w.safe.byKind)
          .map(([k, n]) => `${k} ${n}`)
          .join(", ")})`;
  const errors = Object.keys({
    ...w.l1.errors,
    ...w.l1.httpErrors,
    ...w.era.errors,
    ...w.era.httpErrors,
    ...w.safe.httpErrors,
  }).length
    ? ` · errors ${JSON.stringify({ l1: { ...w.l1.errors, ...w.l1.httpErrors }, era: { ...w.era.errors, ...w.era.httpErrors }, safe: w.safe.httpErrors })}`
    : "";
  const unknown = w.unknownRpc > 0 ? ` · RPC of unknown chain ${w.unknownRpc}` : "";
  const inFlight = w.inFlight > 0 ? ` · ${w.inFlight} unanswered at the end` : "";
  return `${label.padEnd(18)} ${minutes} min · ${w.blocks ?? 0} blocks · ${l1} · ${era} · ${safe}${unknown}${inFlight}${errors}`;
}

// ---- the browser: tabs that beat as a viewer's do ----

type PwRequest = { url(): string };
type PwResponse = { url(): string; status(): number; json(): Promise<unknown> };
type PwPage = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  // Strings only: tsx rewrites functions in ways a browser cannot run.
  evaluate<R>(expression: string): Promise<R>;
  addInitScript(script: { content: string }): Promise<void>;
  on(event: "request", listener: (request: PwRequest) => void): unknown;
  on(event: "response", listener: (response: PwResponse) => void): unknown;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(
    expression: string,
    arg?: unknown,
    options?: { timeout?: number; polling?: number }
  ): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  close(options?: { runBeforeUnload?: boolean }): Promise<void>;
};
type PwContext = { newPage(): Promise<PwPage>; close(): Promise<void> };
type PwBrowser = {
  newContext(options?: { userAgent?: string }): Promise<PwContext>;
  close(): Promise<void>;
};

// The page sees itself hidden or visible as when its tab is switched.
const visibility = (state: "hidden" | "visible") => `(() => {
  Object.defineProperty(document, "visibilityState", { value: "${state}", configurable: true });
  Object.defineProperty(document, "hidden", { value: ${state === "hidden"}, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
})()`;
const HIDDEN_FROM_LOAD = `
  Object.defineProperty(Document.prototype, "visibilityState", { get: () => "hidden", configurable: true });
  Object.defineProperty(Document.prototype, "hidden", { get: () => true, configurable: true });
`;
// An input: the viewer is there, so the tab keeps beating past SYNC_AWAY_MS.
const INPUT = `document.dispatchEvent(new WheelEvent("wheel", { bubbles: true }))`;

let browserPromise: Promise<PwBrowser> | null = null;

/** Chrome through packages/e2e's Playwright (PW_CHANNEL=chrome: the installed Chrome). */
function browser(): Promise<PwBrowser> {
  browserPromise ??= (async () => {
    const require = createRequire(resolve(WEB, "../../packages/e2e/package.json"));
    const entry = require.resolve("@playwright/test");
    const mod = (await import(pathToFileURL(entry).href)) as {
      chromium?: { launch(options: object): Promise<PwBrowser> };
      default?: { chromium?: { launch(options: object): Promise<PwBrowser> } };
    };
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) throw new StopError("Playwright's chromium was not found in packages/e2e.");
    const channel = process.env.PW_CHANNEL;
    return chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  })();
  return browserPromise;
}

class Tab {
  beats = 0;
  dataLoads = 0;
  #context: PwContext | null = null;
  #page: PwPage | null = null;
  #touch: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly server: Server,
    readonly path: string,
    readonly options: { hidden?: boolean } = {}
  ) {}

  async open(): Promise<number> {
    const started = performance.now();
    this.#context = await (await browser()).newContext({ userAgent: BROWSER_UA });
    const page = await this.#context.newPage();
    this.#page = page;
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/resources/presence")) this.beats++;
      if (url.includes("_data=")) this.dataLoads++;
    });
    if (this.options.hidden) await page.addInitScript({ content: HIDDEN_FROM_LOAD });
    await page.goto(`http://127.0.0.1:${this.server.port}${this.path}`, {
      waitUntil: "load",
      timeout: 120_000,
    });
    // Windows longer than SYNC_AWAY_MS would otherwise pause the tab.
    this.#touch = setInterval(() => void this.#page?.evaluate(INPUT).catch(() => {}), 5 * MINUTE);
    this.#touch.unref();
    return Math.round(performance.now() - started);
  }

  async hide(): Promise<void> {
    await this.#page?.evaluate(visibility("hidden"));
  }

  async show(): Promise<void> {
    await this.#page?.evaluate(visibility("visible"));
  }

  page(): PwPage {
    if (!this.#page) throw new StopError("The tab is not open.");
    return this.#page;
  }

  /** Closes it as a viewer does (pagehide: it says it left). */
  async close(): Promise<void> {
    if (this.#touch) clearInterval(this.#touch);
    this.#touch = null;
    await this.#page?.close({ runBeforeUnload: true }).catch(() => {});
    await this.#context?.close().catch(() => {});
    this.#page = null;
    this.#context = null;
  }
}

// ---- servers ----

/** The preview's ports: never started on, never stopped. */
const RESERVED_PORTS = [3000, 3001] as const;

export function overlapsReserved(first: number, last: number): boolean {
  return RESERVED_PORTS.some((port) => first <= port && port <= last);
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

/** One production server on its own port, logging to its own file, its upstream traced. */
class Server {
  readonly log: string;
  readonly #trace: string;
  #dumps = 0;
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
    this.#trace = join(LOGS, `${name}.trace`);
  }

  async start(): Promise<number> {
    if (overlapsReserved(this.port, this.port))
      throw new StopError(`Port ${this.port} is the preview's; use another --port.`);
    if (await answers(this.port)) throw new StopError(`Port ${this.port} is already in use.`);
    for (let n = 0; existsSync(`${this.#trace}.${n}.json`); n++) rmSync(`${this.#trace}.${n}.json`);
    this.#dumps = 0;
    const out = openSync(this.log, "w", 0o600);
    const started = performance.now();
    const child = spawn(process.execPath, ["--import", TRACER, "./server-build/index.js"], {
      cwd: WEB,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SERVER_PORT: String(this.port),
        UPSTREAM_TRACE_OUT: this.#trace,
        ...this.env,
      },
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

  /** What it sent upstream since the last dump (and starts afresh). */
  async dump(): Promise<Trace> {
    const child = this.#child;
    if (!child) throw new StopError(`The ${this.name} server is not running.`);
    const file = `${this.#trace}.${this.#dumps++}.json`;
    child.kill("SIGUSR2");
    for (let i = 0; i < 200; i++) {
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Trace;
      await sleep(50);
    }
    throw new StopError(`The ${this.name} server wrote no trace.`);
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

  /** Stops the benchmark unless both log indexes read their history within 2 minutes. */
  async settled(): Promise<void> {
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      if (indexesSettled(await this.status())) return;
      await sleep(500);
    }
    throw new StopError(
      `Stopped: the ${this.name} server's log indexes did not finish reading their history within 120 s.`
    );
  }

  /** Waits (bounded) until its start's warm-up (prewarm.ts) has finished. */
  async warmedUp(): Promise<void> {
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
      // Its own log: searched for the step's name, never printed.
      if (readFileSync(this.log, "utf8").includes("prewarm finished")) return;
      await sleep(250);
    }
    throw new StopError(`Stopped: the ${this.name} server's warm-up did not finish.`);
  }
}

const running = new Set<Server>();

async function stopAll() {
  stopping.abort(new StopError("The benchmark stopped."));
  await Promise.all([...running].map((server) => server.stop()));
  await (await browserPromise?.catch(() => null))?.close().catch(() => {});
}

// One server starts at a time: each reads the handler's whole history at its start, which several
// at once would turn into the provider's rate limits.
let bootQueue: Promise<unknown> = Promise.resolve();

/** Starts `server` once the servers before it have read their history, and waits until it has. */
function boot(server: Server): Promise<number> {
  const started = bootQueue.then(async () => {
    const ms = await server.start();
    await server.settled();
    await server.warmedUp();
    await server.trusted();
    return ms;
  });
  bootQueue = started.catch(() => {});
  return started;
}

// ---- the conditions ----

type Row = Measurement & { condition: Condition; label: string; context?: Record<string, unknown> };
export type WindowRow = {
  condition: Condition;
  label: string;
  summary: WindowSummary;
  engine: ReturnType<typeof engineSummary>;
  context?: Record<string, unknown>;
};
/** `ok` null: not evaluated (what it checks could not happen in the run; `detail` says why). */
type Check = { condition: Condition; what: string; ok: boolean | null; detail?: unknown };

export function checkMark(ok: boolean | null): string {
  return ok === null ? "n/a " : ok ? "ok  " : "FAIL";
}

class Results {
  rows: Row[] = [];
  windows: WindowRow[] = [];
  checks: Check[] = [];
  notes: Record<string, unknown> = {};

  /** `label`: what is printed in place of the condition (e.g. "head+500"). */
  add(condition: Condition, m: Measurement, context?: Record<string, unknown>, label?: string) {
    this.rows.push({ condition, label: label ?? condition, ...m, ...(context ? { context } : {}) });
    console.log(formatRow(label ?? condition, m));
  }

  window(row: WindowRow) {
    this.windows.push(row);
    console.log(formatWindow(row.label, row.summary));
  }

  check(condition: Condition, what: string, ok: boolean | null, detail?: unknown) {
    this.checks.push({ condition, what, ok, ...(detail === undefined ? {} : { detail }) });
    console.log(`${condition.padEnd(18)} ${checkMark(ok)} ${what}`);
  }
}

type Run = Options & { results: Results };

const scaled = (run: Pick<Run, "scale">, ms: number) => Math.max(1_000, Math.round(ms * run.scale));
const pause = (ms: number) => sleep(ms, undefined, { signal: stopping.signal });

/** A sleep that `signal` ends: a rejection for whoever awaits it, never an unhandled one. */
export function stoppableSleep(ms: number, signal: AbortSignal): Promise<void> {
  const slept = sleep(ms, undefined, { signal });
  slept.catch(() => {});
  return slept;
}

/**
 * One window: what `server` sent upstream during a pause of `during` ms, or while `during` runs
 * (what it sent before is dropped); then, unless `trust` is false, its report and the trust check.
 */
async function costWindow(
  run: Run,
  server: Server,
  condition: Condition,
  label: string,
  during: number | (() => Promise<void>),
  { context, trust = true }: { context?: Record<string, unknown>; trust?: boolean } = {}
): Promise<WindowRow> {
  await server.dump();
  const started = Date.now();
  await (typeof during === "number" ? pause(during) : during());
  const summary = summarizeTrace(await server.dump(), Date.now() - started);
  const status = trust ? await server.trusted() : {};
  const row: WindowRow = {
    condition,
    label,
    summary,
    engine: engineSummary(status),
    ...(context ? { context } : {}),
  };
  run.results.window(row);
  return row;
}

/** Measures `target`, checks the status, and measures the same request again (warm). */
async function withWarm(
  run: Run,
  server: Server,
  condition: Condition,
  label: string,
  target: Target,
  context?: Record<string, unknown>
) {
  run.results.add(condition, await server.request(target), context, label);
  await server.trusted();
  const warm = { ...context, warm: true };
  run.results.add(condition, await server.request(target), warm, `${label} warm`);
}

/** Waits until the app has not been used for `ms` (the keep-warm window, then `ms`). */
async function idleFor(lastUseAt: number, ms: number) {
  await pause(Math.max(0, lastUseAt + KEEPWARM_MS + ms - Date.now()));
}

async function jsonSession(run: Run, port: number) {
  const server = new Server("json", port);
  await boot(server);
  const active: (boolean | null)[] = [];
  const session = await costWindow(run, server, "json", "json session", async () => {
    for (const target of AGENT_SESSION) {
      run.results.add("json", await server.request(target), undefined, "json session");
      if (target.path === "/api/status")
        active.push((await server.status()).sync?.engine?.active ?? null);
    }
  });
  run.results.check(
    "json",
    "a JSON-only session never starts the follower (sync.engine.active false)",
    active.every((a) => a === false) && session.engine.active === false,
    { active, after: session.engine.active }
  );
  const quiet = await costWindow(run, server, "json", "json quiet", scaled(run, 10 * MINUTE));
  run.results.check(
    "json",
    "nothing upstream in the quiet minutes after it",
    silent(quiet.summary)
  );
  // 1 h after the quiet window's status read: only the first is a first request.
  await pause(scaled(run, HOUR_MS));
  for (const [i, target] of RESUME_JSON.entries())
    await withWarm(run, server, "json", "json after 1h", target, {
      pauseMs: scaled(run, HOUR_MS),
      ownPause: i === 0,
    });
  await server.trusted();
  await server.stop();
}

// -- upgrade, idle, then the pages after an hour (chain cache on) --
async function upgradeIdle(run: Run, port: number, done: () => void) {
  const server = new Server("upgrade", port);
  try {
    await boot(server);
    const tab = new Tab(server, `/app/proposals/${UPGRADE_ID}`);
    const loadMs = await tab.open();
    await pause(60_000);
    if (run.conditions.has("upgrade")) {
      const w = await costWindow(run, server, "upgrade", "upgrade", scaled(run, 20 * MINUTE), {
        context: { loadMs },
      });
      run.results.check(
        "upgrade",
        "one upgrade page: L1 ≤ ~1,600/h, Era 0, Safe 0 (executed)",
        w.summary.l1.perHour <= 1_650 &&
          w.summary.era.requests === 0 &&
          w.summary.safe.requests === 0,
        {
          l1PerHour: w.summary.l1.perHour,
          era: w.summary.era.requests,
          safe: w.summary.safe.requests,
        }
      );
      run.results.check(
        "upgrade",
        "engine credits ≤ 500/s",
        (w.engine.enginePeakCreditsPerSecond ?? 0) <= 500,
        {
          enginePeak: w.engine.enginePeakCreditsPerSecond,
          allPeak: w.summary.l1.peakCreditsPerSecond,
        }
      );
      run.results.notes.upgradeBeats = { beats: tab.beats, dataLoads: tab.dataLoads };
    }
    if (run.conditions.has("idle")) await showPages(server);
    await tab.close();
    const closedAt = Math.max(Date.now(), server.lastVisitAt);
    if (run.conditions.has("idle") || run.conditions.has("resume")) {
      await idleFor(closedAt, 0);
      // No status read in between: /api/status reads governance itself.
      let all = true;
      for (const [label, ms] of [
        ["idle 0-10m", 10 * MINUTE],
        ["idle 10-30m", 20 * MINUTE],
        ["idle 30-60m", 30 * MINUTE],
      ] as const) {
        const w = await costWindow(run, server, "idle", label, scaled(run, ms), { trust: false });
        all &&= silent(w.summary);
      }
      run.results.check(
        "idle",
        "nothing upstream for 60 minutes after the use ended (chain cache on)",
        all
      );
      // The pages first: a status read before them would read the head and governance for them.
      await pagesAfterPause(run, server, "idle", "pages after 1h", scaled(run, HOUR_MS));
    }
    await server.trusted();
  } finally {
    await server.stop();
    done();
  }
}

/** The six pages after a pause: first bytes within FIRST_FLUSH_MS, and acceptance target 5. */
export function pagesAfterPauseChecks(
  label: string,
  rows: readonly (Measurement & { context?: Record<string, unknown> })[]
): { what: string; ok: boolean; detail: unknown }[] {
  const all = rows.length === PAGES.length;
  const detail = rows.map((r) => ({
    path: shortPath(r.path),
    ownPause: r.context?.ownPause ?? null,
    ttfbMs: r.ttfbMs,
    dataMs: r.marks?.data ?? null,
    labelledMs: r.marks?.labelled ?? null,
    firstFlush: r.firstFlush ?? null,
    ...(r.error ? { error: r.error } : {}),
  }));
  return [
    {
      what: `${label}: first bytes < ${FIRST_FLUSH_MS} ms on the six pages (first bytes only)`,
      ok: all && rows.every((r) => !r.error && r.ttfbMs >= 0 && r.ttfbMs < FIRST_FLUSH_MS),
      detail,
    },
    {
      what: `${label}: acceptance 5, each page's data (current, or older and labelled) in its first flush (by first bytes + ${FIRST_FLUSH_MS} ms) on the six pages`,
      ok: all && rows.every(dataInFirstFlush),
      detail: {
        without: detail
          .filter((_, i) => !dataInFirstFlush(rows[i] as Measurement))
          .map((d) => d.path),
        pages: detail,
      },
    },
  ];
}

function checkPagesAfterPause(run: Run, condition: Condition, label: string) {
  const rows = run.results.rows.filter((r) => r.label === label && r.condition === condition);
  for (const { what, ok, detail } of pagesAfterPauseChecks(label, rows))
    run.results.check(condition, what, ok, detail);
}

/** The six pages once in use (not measured): after a pause, each first shows what it last did. */
async function showPages(server: Server) {
  for (const target of PAGES) {
    const m = await server.request(target);
    if (m.error) throw new StopError(`Showing ${shortPath(target.path)} failed (${m.error})`);
  }
}

/** The six pages, one after another, after a pause: first bytes and what the first flush shows. */
async function pagesAfterPause(
  run: Run,
  server: Server,
  condition: Condition,
  label: string,
  pauseMs: number
) {
  for (const [i, target] of PAGES.entries()) {
    // Only the first comes after the pause: the others find what it read.
    run.results.add(condition, await server.request(target), { pauseMs, ownPause: i === 0 }, label);
  }
  checkPagesAfterPause(run, condition, label);
}

// -- pages (run A's two), hidden then visible, and the resumes after 90 s and 10 minutes --
async function pagesHiddenResume(run: Run, port: number) {
  const server = new Server("pages", port, { CHAIN_CACHE: "0" });
  await boot(server);
  const tabs = [
    new Tab(server, `/app/proposals/${UPGRADE_ID}`),
    new Tab(server, `/app/emergency/${EMERGENCY_ID}`),
  ];
  for (const tab of tabs) await tab.open();
  await pause(60_000);
  if (run.conditions.has("pages"))
    await costWindow(run, server, "pages", "pages", scaled(run, 15 * MINUTE));
  if (run.conditions.has("hidden")) {
    for (const tab of tabs) await tab.hide();
    await idleFor(Date.now(), 0);
    const hidden = await costWindow(run, server, "hidden", "hidden", scaled(run, 3 * MINUTE));
    run.results.check(
      "hidden",
      "two hidden tabs: nothing upstream after the keep-warm window",
      silent(hidden.summary)
    );
    for (const tab of tabs) await tab.show();
    await costWindow(run, server, "hidden", "visible again", scaled(run, 2 * MINUTE));
  }
  const resume = run.conditions.has("resume");
  if (resume) await showPages(server);
  for (const tab of tabs) await tab.close();
  if (!resume) return server.stop();
  let lastUse = Math.max(Date.now(), server.lastVisitAt);
  // After 90 s: each request after a pause of its own.
  for (const target of [...RESUME_JSON, ...PAGES]) {
    await idleFor(lastUse, scaled(run, 90_000));
    const context = { pauseMs: scaled(run, 90_000), ownPause: true };
    if (target.page)
      run.results.add("resume", await server.request(target), context, "pages after 90s");
    else await withWarm(run, server, "resume", "json after 90s", target, context);
    lastUse = server.lastVisitAt;
  }
  checkPagesAfterPause(run, "resume", "pages after 90s");
  // After 10 minutes: each JSON after a pause of its own, then the pages after one pause.
  for (const target of RESUME_JSON) {
    await idleFor(lastUse, scaled(run, 10 * MINUTE));
    await withWarm(run, server, "resume", "json after 10m", target, {
      pauseMs: scaled(run, 10 * MINUTE),
      ownPause: true,
    });
    lastUse = Math.max(lastUse, server.lastVisitAt, Date.now());
  }
  await idleFor(lastUse, scaled(run, 10 * MINUTE));
  await pagesAfterPause(run, server, "resume", "pages after 10m", scaled(run, 10 * MINUTE));
  await server.trusted();
  await server.stop();
}

/**
 * Acceptance 4: the first JSON after a pause within about 1 s of warm. Only a request after a pause
 * of its own (`context.ownPause`) is a first request; null without any.
 */
export function jsonResumeResult(
  rows: readonly (Measurement & { label: string; context?: Record<string, unknown> })[]
): { ok: boolean | null; detail: unknown } {
  const resumed = rows.filter((r) => /^json after /.test(r.label) && r.context?.warm !== true);
  const firsts = resumed.filter((r) => r.context?.ownPause === true);
  const detail = firsts.map((r) => {
    const warm = rows.find(
      (w) => w.label === `${r.label} warm` && w.path === r.path && rows.indexOf(w) > rows.indexOf(r)
    );
    return {
      label: r.label,
      path: r.path,
      firstMs: r.error ? null : r.completeMs,
      warmMs: warm && !warm.error ? warm.completeMs : null,
    };
  });
  const followed = resumed
    .filter((r) => r.context?.ownPause !== true)
    .map((r) => ({ label: r.label, path: r.path, ms: r.error ? null : r.completeMs }));
  return {
    ok:
      detail.length === 0
        ? null
        : detail.every(
            (d) => d.firstMs !== null && d.warmMs !== null && d.firstMs - d.warmMs <= 1_100
          ),
    detail: { firsts: detail, followed },
  };
}

// -- home, veto list, a tab hidden from its load, then warm and new-block tables --
async function homeVetoWarm(run: Run, port: number) {
  const server = new Server("home", port, { CHAIN_CACHE: "0" });
  await boot(server);
  if (run.conditions.has("home")) {
    const tab = new Tab(server, "/");
    await tab.open();
    await pause(60_000);
    await costWindow(run, server, "home", "home", scaled(run, 10 * MINUTE));
    await tab.close();
  }
  if (run.conditions.has("veto")) {
    const tab = new Tab(server, "/app/l2-cancellations");
    await tab.open();
    await pause(60_000);
    const w = await costWindow(run, server, "veto", "veto list", scaled(run, 10 * MINUTE));
    run.results.check("veto", "veto list: Era ≤ ~240/h", w.summary.era.perHour <= 240, {
      eraPerHour: w.summary.era.perHour,
      byStep: w.summary.era.byStep,
    });
    await tab.close();
    await idleFor(Date.now(), 0);
    const after = await costWindow(run, server, "veto", "veto closed", scaled(run, 2 * MINUTE));
    run.results.check(
      "veto",
      "Era 0 once the veto list is closed",
      after.summary.era.requests === 0
    );
  }
  if (run.conditions.has("hidden")) {
    const tab = new Tab(server, `/app/proposals/${UPGRADE_ID}`, { hidden: true });
    await tab.open();
    await idleFor(Date.now(), 0);
    const w = await costWindow(run, server, "hidden", "hidden from load", scaled(run, 3 * MINUTE));
    run.results.check(
      "hidden",
      "a tab hidden from its load: nothing upstream after the page load's grace",
      silent(w.summary),
      { beats: tab.beats }
    );
    await tab.close();
  }
  if (run.conditions.has("warm") || run.conditions.has("head")) await warmAndHead(run, server);
  await server.trusted();
  await server.stop();
}

// The JSON detail endpoints: a new block can make them slow (their sets are verified again).
const HEAD_SWEEP: readonly Target[] = TARGETS.filter(
  (t) => !t.page && /0x[0-9a-fA-F]{64}$/.test(t.path)
);

/** A page visible: every path read once, then warm; then right after new blocks, trust-checked. */
async function warmAndHead(run: Run, server: Server): Promise<void> {
  const tab = new Tab(server, `/app/proposals/${UPGRADE_ID}`);
  await tab.open();
  await pause(30_000);
  for (const target of TARGETS) await server.request(target);
  await sleep(2_000);
  if (run.conditions.has("warm"))
    for (const target of TARGETS) {
      run.results.add("warm", await server.request(target));
      await server.trusted();
    }
  if (run.conditions.has("head")) {
    let last = (await server.status()).sync?.engine?.head?.number ?? null;
    // As soon as the engine serves a new head.
    for (const target of TARGETS) {
      const head = await waitForHead(server, last, true);
      last = head.number;
      const sentAt = Date.now();
      const m = await server.request(target);
      await server.trusted();
      run.results.add("head", m, {
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
        run.results.add(
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
    run.results.notes.headWorst = worstByPath(
      run.results.rows.filter((row) => row.condition === "head")
    );
  }
  await tab.close();
}

/** The engine's first head other than `previous` (with `served`: once served), within a minute. */
async function waitForHead(
  server: Server,
  previous: string | null,
  served: boolean
): Promise<{ number: string; observedAt: number; servedAt: number | null }> {
  const until = Date.now() + 60_000;
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
 * An open set's Safe watcher against its hourly bound, paused or not: it reaches its own pauses
 * (budget, quota) by sending. Not evaluated (null) only when it was paused and sent nothing.
 */
export function watcherResult(
  w: Pick<WindowRow, "summary" | "engine">,
  watchedSafes: number,
  bound: number
): { ok: boolean | null; detail: Record<string, unknown> } {
  const paused = (w.engine.safe?.paused ?? null) && w.summary.safe.requests === 0;
  return {
    ok: paused ? null : w.summary.safe.perHour <= Math.max(bound, 1) * 1.1 + 6,
    detail: {
      safePerHour: w.summary.safe.perHour,
      watchedSafes,
      bound,
      byKind: w.summary.safe.byKind,
      ...(paused
        ? {
            notEvaluated: `the Safe watcher was paused (${w.engine.safe?.paused}) and sent nothing`,
          }
        : {}),
    },
  };
}

async function openSet(run: Run, port: number, condition: "open" | "keyless") {
  const server = new Server(condition, port, {
    CHAIN_CACHE: "0",
    // Safe's public service: no key from the environment, .env or the saved settings.
    ...(condition === "keyless"
      ? {
          SAFE_API_KEY: "",
          LOCAL_SETTINGS_IGNORE: [process.env.LOCAL_SETTINGS_IGNORE, "SAFE_API_KEY"]
            .filter(Boolean)
            .join(","),
        }
      : {}),
  });
  await boot(server);
  const tab = new Tab(server, run.openPath);
  await tab.open();
  const page = tab.page();
  const hasOpenSet = await page
    .waitForSelector('[data-testid="fetch-signatures"]', { timeout: 60_000 })
    .then(
      () => true,
      () => false
    );
  if (!hasOpenSet) {
    run.results.check(condition, `${shortPath(run.openPath)} shows an open signature set`, false);
    await tab.close();
    await server.stop();
    return;
  }
  await pause(30_000);
  const watched = (await server.status()).sync?.safe?.watched ?? null;
  const w = await costWindow(
    run,
    server,
    condition,
    condition === "open" ? "open set" : "open keyless",
    scaled(run, 10 * MINUTE),
    { context: { watched } }
  );
  const safes = watched?.safes ?? 0;
  const result = watcherResult(w, safes, condition === "open" ? safes * 60 : safes * 12);
  run.results.check(
    condition,
    condition === "open"
      ? "an open set: Safe ≤ not-yet-valid members × 60/h (with a key, quota-guarded)"
      : "keyless: Safe ≤ members × 12/h",
    result.ok,
    result.detail
  );
  // "Fetch signatures": the set's member Safes read now, the set verified again, in place.
  await server.dump();
  const answered = new Promise<{ status: number; checked: unknown; failed: unknown }>((resolve) => {
    page.on("response", (response) => {
      if (!response.url().includes("/resources/safe-check")) return;
      void response
        .json()
        .catch(() => null)
        .then((body) => {
          const { checked = null, failed = null } = (body ?? {}) as Record<string, unknown>;
          resolve({ status: response.status(), checked, failed });
        });
    });
  });
  const started = performance.now();
  await page.click('[data-testid="fetch-signatures"]', { timeout: 10_000 });
  const answer = await Promise.race([answered, pause(120_000).then(() => null)]);
  const answerMs = Math.round(performance.now() - started);
  // The card shows the result in place once the page has reloaded its data.
  await page.waitForFunction(
    `(() => { const b = document.querySelector('[data-testid="fetch-signatures"]'); return !!b && !b.disabled; })()`,
    undefined,
    { timeout: 120_000, polling: 50 }
  );
  const buttonMs = Math.round(performance.now() - started);
  const fetched = summarizeTrace(await server.dump(), Math.max(1, buttonMs));
  run.results.notes[`${condition}FetchSignatures`] = {
    answerMs,
    buttonMs,
    answer,
    safe: fetched.safe.requests,
    safeByKind: fetched.safe.byKind,
    safeErrors: fetched.safe.httpErrors,
    l1: fetched.l1.requests,
    l1ByStep: Object.fromEntries(Object.entries(fetched.l1.byStep).map(([k, v]) => [k, v.n])),
  };
  console.log(
    `${condition.padEnd(18)} Fetch signatures: answer ${fmt(answerMs)} ms (${JSON.stringify(answer)}), button ${fmt(buttonMs)} ms · Safe ${fetched.safe.requests} · L1 ${fetched.l1.requests}`
  );
  await tab.close();
  await idleFor(Date.now(), 0);
  const after = await costWindow(
    run,
    server,
    condition,
    `${condition} closed`,
    scaled(run, 2 * MINUTE)
  );
  run.results.check(condition, "nothing upstream once the page is closed", silent(after.summary));
  await server.stop();
}

/** A restart's chain cache: loaded at its start (provisional or verified), then verified. */
export function cacheReloaded(atStart: string | null, after: string | null): boolean {
  return (atStart === "provisional" || atStart === "verified") && after === "verified";
}

async function restart(run: Run, port: number) {
  const server = new Server("restart", port);
  const bootMs = await server.start();
  const status = await server.status();
  // At liftoff: the six pages at once, as a browser restoring tabs; then the JSON.
  const pages = await Promise.all(PAGES.map((target) => server.request(target)));
  for (const m of pages)
    run.results.add(
      "restart",
      m,
      { bootMs, cache: status.sync?.cache?.state ?? null },
      "restart pages"
    );
  for (const target of RESUME_JSON)
    run.results.add("restart", await server.request(target), undefined, "restart json");
  await server.settled();
  const after = await server.trusted();
  run.results.check(
    "restart",
    "the chain cache loaded and verified",
    cacheReloaded(status.sync?.cache?.state ?? null, after.sync?.cache?.state ?? null),
    { atStart: status.sync?.cache?.state ?? null, after: after.sync?.cache?.state ?? null }
  );
  await server.stop();
}

/** One fresh server per path: each path is the first request it gets, at liftoff. */
async function freshProcesses(condition: "fresh" | "cache", run: Run, port: number): Promise<void> {
  for (const [i, target] of TARGETS.entries()) {
    const server = new Server(
      `${condition}-${i}`,
      port,
      condition === "fresh" ? { CHAIN_CACHE: "0" } : {}
    );
    const bootMs = await server.start();
    const m = await server.request(target);
    const status = await server.trusted();
    run.results.add(condition, m, { bootMs, cache: status.sync?.cache?.state ?? null });
    // With the cache: the whole history read first, so that the shutdown save keeps it all.
    if (condition === "cache") await server.settled();
    await server.stop();
  }
}

// ---- main ----

export type Options = { conditions: Set<Condition>; port: number; scale: number; openPath: string };

export function parseArgs(argv: readonly string[]): Options {
  let conditions = new Set<Condition>(DEFAULT_CONDITIONS);
  let port = 3105;
  let scale = 1;
  let openPath = OPEN_PATH;
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
      if (overlapsReserved(port, port + 5))
        throw new StopError("--port: the six ports must not include 3000 or 3001");
    } else if (key === "scale") {
      scale = Number(value);
      if (!(scale > 0 && scale <= 10))
        throw new StopError("--scale must be above 0 and at most 10");
    } else if (key === "open") {
      if (!/^\/app\/(emergency|proposals)\/0x[0-9a-fA-F]{64}$/.test(value))
        throw new StopError("--open must be an upgrade or emergency upgrade page path");
      openPath = value;
    } else {
      throw new StopError(`Unknown argument ${arg}`);
    }
  }
  return { conditions, port, scale, openPath };
}

const any = (run: Run, ...conditions: Condition[]) => conditions.some((c) => run.conditions.has(c));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(join(WEB, "server-build/index.js")) || !existsSync(join(WEB, "build/server")))
    throw new StopError("No production build: run `corepack pnpm --filter web build` first.");
  mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  const results = new Results();
  const run: Run = { ...options, results };
  const startedAt = new Date().toISOString();
  const { port } = options;

  // The trust check first, on its own.
  const gate = new Server("gate", port);
  await boot(gate);
  results.notes.status = statusSummary(await gate.trusted());
  console.log(`status ${JSON.stringify(results.notes.status)}`);
  await gate.stop();

  // Side by side, one server each; the second wave once the first's windows in use are over.
  let upgradeDone: () => void = () => {};
  const upgradeFinished = new Promise<void>((resolve) => {
    upgradeDone = resolve;
  });
  // The first wave's windows in use end after about 22 minutes; when none runs, nobody waits.
  const firstWave = any(run, "upgrade", "pages", "hidden", "home", "veto")
    ? stoppableSleep(scaled(run, 22 * MINUTE), stopping.signal)
    : Promise.resolve();
  const tasks: Promise<unknown>[] = [];
  if (any(run, "json")) tasks.push(jsonSession(run, port));
  if (any(run, "upgrade", "idle")) tasks.push(upgradeIdle(run, port + 1, upgradeDone));
  else upgradeDone();
  if (any(run, "pages", "hidden", "resume")) tasks.push(pagesHiddenResume(run, port + 2));
  if (any(run, "home", "veto", "hidden", "warm", "head")) tasks.push(homeVetoWarm(run, port + 3));
  if (any(run, "open")) tasks.push(firstWave.then(() => openSet(run, port + 4, "open")));
  tasks.push(
    (async () => {
      if (any(run, "keyless")) {
        await firstWave;
        await openSet(run, port + 5, "keyless");
      }
      if (any(run, "restart")) {
        await upgradeFinished;
        await restart(run, port + 5);
      }
      if (any(run, "fresh")) await freshProcesses("fresh", run, port + 5);
      if (any(run, "cache")) await freshProcesses("cache", run, port + 5);
    })()
  );
  try {
    await Promise.all(tasks);
    if (any(run, "json", "resume")) {
      const { ok, detail } = jsonResumeResult(results.rows);
      results.check(
        "resume",
        "first JSON after a pause within ~1 s of warm (status, lists; requests after a pause of their own)",
        ok,
        detail
      );
    }
  } finally {
    const file = join(OUT, "benchmark-sync.json");
    await writeFile(
      file,
      `${JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          options: {
            conditions: [...options.conditions],
            scale: options.scale,
            openPath: options.openPath,
          },
          notes: results.notes,
          checks: results.checks,
          windows: results.windows,
          rows: results.rows,
        },
        null,
        2
      )}\n`
    );
    console.log(`results ${relative(process.cwd(), file)}`);
  }
  const failed = results.checks.filter((c) => c.ok === false);
  if (failed.length > 0)
    console.log(
      `${failed.length} check(s) did not hold: ${failed.map((c) => `${c.condition}: ${c.what}`).join("; ")}`
    );
  const open = results.checks.filter((c) => c.ok === null);
  if (open.length > 0)
    console.log(
      `${open.length} check(s) not evaluated: ${open.map((c) => `${c.condition}: ${c.what}`).join("; ")}`
    );
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
