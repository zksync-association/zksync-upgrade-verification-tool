import { AsyncLocalStorage } from "node:async_hooks";
import { type Address, isAddress } from "viem";

// Who is using the app right now, and what is on their screens. The sync engine follows the chain
// only while someone is (SYNC_MODE=window, the default), and then only for what is on screen:
// when nobody uses the app it sends nothing upstream at all.
//
// Two signals count, both from this machine's browser and both same-origin:
// - a beat from a visible tab (components/presence.tsx, POST /resources/presence): the tab counts
//   for SYNC_KEEPWARM_MS after its last beat, or until it says it left (hidden, closed, or its
//   viewer away for SYNC_AWAY_MS), with the keys of what it renders;
// - a page load (a document or data GET that is neither a prefetch nor a cross-site request):
//   it counts for SYNC_KEEPWARM_MS too, a grace that covers the time until the page's first beat
//   (and pages whose script failed), with the keys its loader issued (those found while it loads,
//   a signature set's, included: see pageLoad).
// Nothing else is use: /api/* (curl, agents) and /api/status read on demand, and prefetches,
// cross-site requests (the Safe{Wallet} frame's document load), hidden tabs and the beats
// themselves keep nothing running. Nothing here sends a request, keeps a timer, or stores
// anything outside this process; nothing about a tab is kept but an opaque id it chose and the
// keys the server issued to it.

/** The path tabs beat to. */
export const PRESENCE_PATH = "/resources/presence";

/** How often a visible tab beats (the answer's `nextMs`). */
export const BEAT_EVERY_MS = 10_000;

export const PRESENCE_LIMITS = {
  /** Largest beat body accepted. */
  bodyBytes: 8_192,
  /** Keys per beat. */
  items: 32,
  /** Tabs counted at once (the one beaten least recently goes first). */
  tabs: 64,
  /** Page loads in their grace at once (the oldest go first). */
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

/**
 * Something a page renders, named by the server (page loaders issue these; never /api/* JSON):
 * `status`, `list:<kind>`, `upgrade:<id>`, `emergency:<id>`, `set:<hash>`, `l2:<governor>:<id>`,
 * `tx:<hash>`. `rev` is null until the server tracks revisions.
 */
export type WatchItem = { key: string; rev: string | null };

/** A beat, as POST /resources/presence carries it (validated by parseBeat). */
export type Beat = {
  /** The tab's own random id (a new one for each page it loads). */
  tab: string;
  reason: PresenceReason;
  items: WatchItem[];
  /** With reason "signed": the member Safe the viewer just signed for. */
  signed?: { safe: Address };
  /** With reason "leave": the tab stops because its viewer was away for SYNC_AWAY_MS. */
  away?: boolean;
};

const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Keys are the server's own: a kind and lower-case hex or words, never a URL's search string.
const KEY = /^[a-z0-9][a-z0-9:._-]{0,159}$/;

/** A beat's body checked against the wire format and the limits; null when it is not one. */
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

/** What presence needs to know about an HTTP request (Express's or a loader's). */
export type RequestInfo = {
  method: string;
  /** The URL's path, without its search string. */
  path: string;
  /** A request header by its lower-case name. */
  header: (name: string) => string | null | undefined;
};

/** The same, from a Fetch API request (what a Remix loader gets). */
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

/**
 * Whether a request is a page load: a GET of a page or a page's data (`?_data=`), or the Refresh
 * button's POST /resources/refresh, from this app's own pages or typed in (Sec-Fetch-Site
 * same-origin, none, or no such header), and not a prefetch. Never /api/* or the beat itself.
 * Paths match as the router matches them: case aside, with or without a trailing slash.
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
  return method === "POST" && path === "/resources/refresh";
}

/**
 * Whether a beat may be recorded: a JSON body, sent by this app's own pages. A browser marks a
 * request from another site (`Sec-Fetch-Site` other than same-origin, and an `Origin` it does not
 * let pages change); one without the header must name this origin. Another site's page cannot
 * send a JSON POST here without a preflight the server never answers, so it can never keep the
 * app following the chain at the user's RPC cost.
 */
export function isOwnBeat(info: RequestInfo, origin: string): boolean {
  const type = info.header("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return false;
  const site = info.header("sec-fetch-site")?.toLowerCase();
  if (site) return site === "same-origin";
  return info.header("origin") === origin;
}

export type PresenceStatus = {
  /** Someone is using the app: a tab beat, or a page loaded, within SYNC_KEEPWARM_MS. */
  inUse: boolean;
  /** What keeps it in use: a beating tab, else a page load's grace; null when not in use. */
  reason: "tab" | "page-load" | null;
  /** Tabs that beat within SYNC_KEEPWARM_MS and did not leave. */
  tabs: number;
  /** Distinct keys on screen (tabs' and page loads'). */
  keys: number;
  /** When the last beat arrived (ISO time), or null. */
  lastBeatAt: string | null;
  /** Tabs that stopped because nobody touched them for SYNC_AWAY_MS (until they beat again). */
  pausedAway: number;
};

type Tab = { keys: readonly string[]; beatAt: number };
type Load = { keys: string[]; at: number };

/** A page load's entry: `add` puts a key found while the page loads on screen for its grace. */
export type LoadHandle = { add(key: string): void };

// A tab that left because its viewer was away is remembered (for `pausedAway`) at most this long.
const AWAY_FOR_MS = 24 * 60 * 60_000;

export type PresenceOptions = {
  /** How long a beat or a page load counts (SYNC_KEEPWARM_MS). */
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

  /**
   * A page load: in use for SYNC_KEEPWARM_MS, with the keys its loader issued (if any), and
   * those it finds later (`add`, at most PRESENCE_LIMITS.items in all).
   */
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

  /** Records a beat (see Beat). A leave ends the tab now. */
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

  /** Someone is using the app now. */
  inUse(): boolean {
    this.#prune(this.#now());
    return this.#tabs.size > 0 || this.#loads.length > 0;
  }

  /** The keys on screen now: every counted tab's and page load's. Empty when not in use. */
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
// SYNC_KEEPWARM_MS, as the sync engine reads it from the environment (readKeepWarmFrom). This module
// reads no environment itself: page modules import it, and run in the browser too.
const DEFAULT_KEEPWARM_MS = 30_000;
let keepWarm: () => number = () => DEFAULT_KEEPWARM_MS;

/** Where the registry reads SYNC_KEEPWARM_MS from (the sync engine, at its start). */
export function readKeepWarmFrom(read: () => number) {
  keepWarm = read;
}

/** The process's presence registry (SYNC_KEEPWARM_MS read on each check). */
export function presence(): Presence {
  instance ??= new Presence({ keepWarmMs: () => keepWarm() });
  return instance;
}

/** Forgets every tab and page load; `options` replaces SYNC_KEEPWARM_MS (tests). */
export function resetPresence(options?: PresenceOptions) {
  instance = options ? new Presence(options) : null;
}

/**
 * For a page loader: the keys of what the page renders, as its data carries them (`watch`), and,
 * when the request is a page load (see isPageLoad), registered as on screen for the load's grace
 * so the engine covers them before the page's first beat. A prefetch or a cross-site load gets the
 * same data but registers nothing.
 */
export function watchItems(request: Request, keys: readonly string[]): WatchItem[] {
  return pageLoad(request, keys).watch;
}

// The page load a loader's work runs for (pageLoad's `run`), as its asynchronous continuations
// see it: how a key found while the page loads (a signature set's) joins that load's grace.
const loading = new AsyncLocalStorage<(key: string) => void>();

/**
 * watchItems, for a loader whose page shows things only known once read (signature sets, whose
 * keys come from governance): `run` the loading in this page load's context, and every key
 * onPageLoad() is told meanwhile joins the load's grace as `keys` do. A prefetch or a cross-site
 * load runs it as it is: nothing registered.
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

/**
 * A key found while a page loads (see pageLoad): on screen for that page load's grace. Nothing
 * outside one (JSON, a prefetch, the engine).
 */
export function onPageLoad(key: string) {
  loading.getStore()?.(key);
}

/** Keys of things on ZKsync Era: while one is on screen, the engine also follows Era. */
export function isL2Key(key: string): boolean {
  return key.startsWith("l2:") || key === "list:vetoes" || key === "list:startable";
}

/** The page keys (lower case, so the same item always has the same key). */
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
