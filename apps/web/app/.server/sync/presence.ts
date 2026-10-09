import { AsyncLocalStorage } from "node:async_hooks";
import { type Address, isAddress } from "viem";

// Who uses the app now, and what is on their screens: the engine follows the chain only then. Two
// same-origin signals count, each for SYNC_KEEPWARM_MS: a visible tab's beat (until it leaves:
// hidden, closed, or its viewer away for SYNC_AWAY_MS) and a page load (a GET that is neither a
// prefetch nor cross-site). /api/* never counts. Nothing here sends a request or keeps a timer.

export const PRESENCE_PATH = "/resources/presence";

export const BEAT_EVERY_MS = 10_000;

export const PRESENCE_LIMITS = {
  bodyBytes: 8_192,
  items: 32,
  tabs: 64,
  loads: 64,
} as const;

export type PresenceReason =
  | "load"
  | "interval"
  | "visible"
  | "nav"
  | "focus"
  | "signed"
  | "resume"
  | "leave";

const REASONS: ReadonlySet<string> = new Set<PresenceReason>([
  "load",
  "interval",
  "visible",
  "nav",
  "focus",
  "signed",
  "resume",
  "leave",
]);

/** A server-issued key of what a page renders (`status`, `upgrade:<id>`, `set:<hash>`, ...). */
export type WatchItem = { key: string; rev: string | null };

export type Beat = {
  tab: string;
  reason: PresenceReason;
  items: WatchItem[];
  signed?: { safe: Address };
  away?: boolean;
};

const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Keys are the server's own: a kind and lower-case hex or words, never a URL's search string.
const KEY = /^[a-z0-9][a-z0-9:._-]{0,159}$/;

export function parseBeat(value: unknown): Beat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { tab, reason, items, signed, away } = value as Record<string, unknown>;
  if (typeof tab !== "string" || !TAB_ID.test(tab)) return null;
  if (typeof reason !== "string" || !REASONS.has(reason)) return null;
  const list = items === undefined ? [] : items;
  if (!Array.isArray(list) || list.length > PRESENCE_LIMITS.items) return null;
  const parsed: WatchItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const { key, rev } = item as Record<string, unknown>;
    if (typeof key !== "string" || !KEY.test(key)) return null;
    if (rev !== null && rev !== undefined && (typeof rev !== "string" || rev.length > 64))
      return null;
    parsed.push({ key, rev: typeof rev === "string" ? rev : null });
  }
  const beat: Beat = { tab, reason: reason as PresenceReason, items: parsed };
  if (signed !== undefined) {
    const safe = (signed as { safe?: unknown } | null)?.safe;
    if (typeof safe !== "string" || !isAddress(safe, { strict: false })) return null;
    beat.signed = { safe: safe as Address };
  }
  if (away !== undefined) {
    if (typeof away !== "boolean") return null;
    beat.away = away;
  }
  return beat;
}

export type RequestInfo = {
  method: string;
  path: string;
  header: (name: string) => string | null | undefined;
};

export function requestInfo(request: Request): RequestInfo {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    header: (name) => request.headers.get(name),
  };
}

// A prefetch or prerender says so: Chrome `Sec-Purpose: prefetch[;prerender]`, older browsers
// `Purpose: prefetch`, Firefox `X-Moz: prefetch`, Safari's previews `X-Purpose: preview`.
const PREFETCH = /\b(?:prefetch|prerender|preview)\b/i;

const VIEWER_POSTS = new Set(["/resources/refresh", "/resources/safe-check"]);

/**
 * A GET of a page or its data, or a viewer's Refresh / Fetch signatures POST, same-origin or typed
 * in, and not a prefetch. Never /api/* or the beat. Paths match as the router matches them.
 */
export function isPageLoad(info: RequestInfo): boolean {
  const path = info.path.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/api" || path.startsWith("/api/") || path === PRESENCE_PATH) return false;
  const purpose = ["sec-purpose", "purpose", "x-moz", "x-purpose"]
    .map((name) => info.header(name) ?? "")
    .join(" ");
  if (PREFETCH.test(purpose)) return false;
  const site = info.header("sec-fetch-site")?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const method = info.method.toUpperCase();
  if (method === "GET") return true;
  return method === "POST" && VIEWER_POSTS.has(path);
}

/**
 * A JSON body from this app's own pages. Another site cannot send a JSON POST without a preflight
 * the server never answers, so it can never keep the app following the chain at the user's cost.
 */
export function isOwnBeat(info: RequestInfo, origin: string): boolean {
  const type = info.header("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return false;
  const site = info.header("sec-fetch-site")?.toLowerCase();
  if (site) return site === "same-origin";
  return info.header("origin") === origin;
}

export type PresenceStatus = {
  inUse: boolean;
  reason: "tab" | "page-load" | null;
  tabs: number;
  keys: number;
  lastBeatAt: string | null;
  pausedAway: number;
};

type Tab = { keys: readonly string[]; beatAt: number };
type Load = { keys: string[]; at: number };

export type LoadHandle = { add(key: string): void };

const AWAY_FOR_MS = 24 * 60 * 60_000;

export type PresenceOptions = {
  keepWarmMs: number | (() => number);
  now?: () => number;
};

export class Presence {
  readonly #keepWarmMs: () => number;
  readonly #now: () => number;
  readonly #tabs = new Map<string, Tab>();
  #loads: Load[] = [];
  readonly #away = new Map<string, number>();
  #lastBeatAt: number | null = null;

  constructor({ keepWarmMs, now = () => Date.now() }: PresenceOptions) {
    this.#keepWarmMs = typeof keepWarmMs === "function" ? keepWarmMs : () => keepWarmMs;
    this.#now = now;
  }

  load(keys: Iterable<string> = []): LoadHandle {
    const now = this.#now();
    this.#prune(now);
    const load: Load = { keys: [...new Set(keys)].slice(0, PRESENCE_LIMITS.items), at: now };
    this.#loads.push(load);
    if (this.#loads.length > PRESENCE_LIMITS.loads)
      this.#loads.splice(0, this.#loads.length - PRESENCE_LIMITS.loads);
    return {
      add: (key) => {
        if (load.keys.length < PRESENCE_LIMITS.items && !load.keys.includes(key))
          load.keys.push(key);
      },
    };
  }

  beat(beat: Beat) {
    const now = this.#now();
    this.#prune(now);
    if (beat.reason === "leave") {
      this.#tabs.delete(beat.tab);
      if (beat.away) this.#rememberAway(beat.tab, now);
      return;
    }
    this.#away.delete(beat.tab);
    if (!this.#tabs.has(beat.tab) && this.#tabs.size >= PRESENCE_LIMITS.tabs) {
      let stalest: string | null = null;
      let at = Number.POSITIVE_INFINITY;
      for (const [tab, entry] of this.#tabs)
        if (entry.beatAt < at) {
          at = entry.beatAt;
          stalest = tab;
        }
      if (stalest !== null) this.#tabs.delete(stalest);
    }
    this.#tabs.set(beat.tab, { keys: beat.items.map((item) => item.key), beatAt: now });
    this.#lastBeatAt = now;
  }

  inUse(): boolean {
    this.#prune(this.#now());
    return this.#tabs.size > 0 || this.#loads.length > 0;
  }

  onScreen(): ReadonlySet<string> {
    this.#prune(this.#now());
    const keys = new Set<string>();
    for (const tab of this.#tabs.values()) for (const key of tab.keys) keys.add(key);
    for (const load of this.#loads) for (const key of load.keys) keys.add(key);
    return keys;
  }

  status(): PresenceStatus {
    const now = this.#now();
    this.#prune(now);
    const reason = this.#tabs.size > 0 ? "tab" : this.#loads.length > 0 ? "page-load" : null;
    return {
      inUse: reason !== null,
      reason,
      tabs: this.#tabs.size,
      keys: this.onScreen().size,
      lastBeatAt: this.#lastBeatAt === null ? null : new Date(this.#lastBeatAt).toISOString(),
      pausedAway: this.#away.size,
    };
  }

  #prune(now: number) {
    const keepWarm = this.#keepWarmMs();
    for (const [tab, entry] of this.#tabs)
      if (!(now - entry.beatAt <= keepWarm)) this.#tabs.delete(tab);
    if (this.#loads.length > 0) this.#loads = this.#loads.filter((l) => now - l.at <= keepWarm);
    for (const [tab, at] of this.#away) if (!(now - at <= AWAY_FOR_MS)) this.#away.delete(tab);
  }

  #rememberAway(tab: string, now: number) {
    this.#away.delete(tab);
    this.#away.set(tab, now);
    while (this.#away.size > PRESENCE_LIMITS.tabs)
      this.#away.delete(this.#away.keys().next().value as string);
  }
}

let instance: Presence | null = null;
// This module reads no environment itself: page modules import it, and run in the browser too.
const DEFAULT_KEEPWARM_MS = 30_000;
let keepWarm: () => number = () => DEFAULT_KEEPWARM_MS;

export function readKeepWarmFrom(read: () => number) {
  keepWarm = read;
}

export function presence(): Presence {
  instance ??= new Presence({ keepWarmMs: () => keepWarm() });
  return instance;
}

export function resetPresence(options?: PresenceOptions) {
  instance = options ? new Presence(options) : null;
}

/** A page's keys; on a page load also on screen for its grace, before the page's first beat. */
export function watchItems(request: Request, keys: readonly string[]): WatchItem[] {
  return pageLoad(request, keys).watch;
}

const loading = new AsyncLocalStorage<(key: string) => void>();

/**
 * watchItems for a page whose keys are known only once read (signature sets): keys onPageLoad()
 * is told while `run` runs join the load's grace.
 */
export function pageLoad(
  request: Request,
  keys: readonly string[] = []
): { watch: WatchItem[]; run<T>(work: () => T): T } {
  const watch = keys.map((key) => ({ key, rev: null }));
  if (!isPageLoad(requestInfo(request))) return { watch, run: (work) => work() };
  const registry = presence();
  let handle: LoadHandle | null = keys.length > 0 ? registry.load(keys) : null;
  const add = (key: string) => {
    if (handle) handle.add(key);
    else handle = registry.load([key]);
  };
  return { watch, run: (work) => loading.run(add, work) };
}

export function onPageLoad(key: string) {
  loading.getStore()?.(key);
}

/** While a key on ZKsync Era is on screen, the engine also follows Era. */
export function isL2Key(key: string): boolean {
  return key.startsWith("l2:") || key === "list:vetoes" || key === "list:startable";
}

export const watchKeys = {
  status: "status",
  upgrades: (all: boolean) => (all ? "list:upgrades:all" : "list:upgrades"),
  emergencies: (all: boolean) => (all ? "list:emergency:all" : "list:emergency"),
  freezes: "list:freeze",
  vetoes: "list:vetoes",
  startable: "list:startable",
  upgrade: (id: string) => `upgrade:${id.toLowerCase()}`,
  emergency: (id: string) => `emergency:${id.toLowerCase()}`,
  l2: (governor: string, proposalId: bigint | string) =>
    `l2:${governor.toLowerCase()}:${proposalId.toString()}`,
  tx: (hash: string) => `tx:${hash.toLowerCase()}`,
} as const;
