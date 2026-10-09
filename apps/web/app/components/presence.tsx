import type { PuhIndexStatus } from "@/.server/chain/puh-index";
import type { SafeCheck } from "@/.server/safe/store";
import { requestStatusRevalidation } from "@/utils/revalidation";
import { useMatches, useNavigation, useRevalidator } from "@remix-run/react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// While this tab is visible it beats every 10 s (POST /resources/presence) with the keys of what it
// shows and their revisions as rendered: the app follows the chain only while some tab does, and
// only for what is on screen. A hidden tab (or a hidden Safe{Wallet} frame), a closed one and one
// nobody touched for SYNC_AWAY_MS leave. Beats are plain fetches (a Remix fetcher would revalidate
// the page after each), carry no part of the URL (its search string can hold ?sig=), and make the
// server send nothing upstream by themselves. An answer naming changed keys reloads the page's
// data in place (a same-pathname revalidation keeps what is on screen until the new data is in),
// as Reloader allows.

export const PRESENCE_URL = "/resources/presence";
export const SAFE_CHECK_URL = "/resources/safe-check";
export const BEAT_MS = 10_000;
const MIN_NEXT_MS = 2_000;
const MAX_NEXT_MS = 60_000;
const KEYS_SETTLE_MS = 250;
const FOCUS_AFTER_MS = 5_000;
/** At most this many keys go in a beat (the server's limit). */
const MAX_KEYS = 32;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
export const RELOAD_GAP_MS = 5_000;
export const UNKNOWN_EVERY_MS = 60_000;

export type PresenceReason =
  | "load"
  | "interval"
  | "visible"
  | "nav"
  | "focus"
  | "signed"
  | "resume"
  | "leave";

export type WatchItem = { key: string; rev: string | null };

/** What the server answers a beat with (routes/resources+/presence.ts BeatAnswer). */
export type BeatAnswer = {
  changed: string[];
  unknown: string[];
  catchingUp: boolean;
  head: { number: string; hash: string; timestamp: string } | null;
  checked: Record<string, SafeCheck>;
  // By key, the newest head the content shown (`rev`) was verified at (sets) or noted at (other
  // items but Era's). Not named, or named at a block before `head`: not current.
  verifiedAt: Record<string, { rev: string; block: string }>;
  notedAt: Record<string, { rev: string; block: string }>;
  eraAt: Record<string, { number: string; readAt: string }>;
  era: { number: string; readAt: string } | null;
  simulatedAt: Record<string, string>;
  index: PuhIndexStatus | null;
  nextMs: number;
};

export type BeaterOptions = {
  /** A visible tab nobody touched for this long stops beating (0: never). */
  awayMs: number;
  url?: string;
  fetch?: typeof fetch;
  sendBeacon?: (url: string, body: Blob) => boolean;
  now?: () => number;
  doc?: Document;
  win?: Window;
  tab?: string;
  onAnswer?: (answer: Partial<BeatAnswer>) => void;
  onState?: (state: { away: boolean; failing: boolean; lastBeatAt: number | null }) => void;
};

// Never kept: Duplicate Tab copies sessionStorage, and two tabs sharing an id would overwrite each
// other's keys, and one's leave would end the other.
function tabId(win: Window): string {
  return typeof win.crypto?.randomUUID === "function"
    ? win.crypto.randomUUID()
    : `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

const keysOf = (items: readonly WatchItem[]) => items.map((item) => item.key).join("\n");

export class Beater {
  readonly #options: Required<
    Omit<BeaterOptions, "tab" | "sendBeacon" | "onAnswer" | "onState">
  > & {
    sendBeacon?: BeaterOptions["sendBeacon"];
    onAnswer?: BeaterOptions["onAnswer"];
    onState?: BeaterOptions["onState"];
  };
  readonly #tab: string;
  #items: WatchItem[] = [];
  #sentKeys: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #keysTimer: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;
  #lastBeatAt: number | null = null;
  #lastInputAt: number;
  #away = false;
  // Framed (Safe{Wallet}) and the frame is not on screen.
  #occluded = false;
  #present = false;
  #started = false;
  #inFlight = false;
  #observer: IntersectionObserver | null = null;
  readonly #cleanups: (() => void)[] = [];

  constructor(options: BeaterOptions) {
    const win = options.win ?? window;
    this.#options = {
      url: PRESENCE_URL,
      fetch: (...args) => win.fetch(...args),
      now: Date.now,
      doc: win.document,
      ...options,
      win,
      sendBeacon:
        options.sendBeacon ??
        (typeof win.navigator?.sendBeacon === "function"
          ? (url, body) => win.navigator.sendBeacon(url, body)
          : undefined),
    };
    this.#tab = options.tab ?? tabId(win);
    this.#lastInputAt = this.#options.now();
  }

  get tab(): string {
    return this.#tab;
  }

  get away(): boolean {
    return this.#away;
  }

  get visible(): boolean {
    return this.#visible();
  }

  start() {
    if (this.#started) return;
    this.#started = true;
    const { doc, win } = this.#options;
    const on = (target: EventTarget, type: string, listener: (event: Event) => void) => {
      target.addEventListener(type, listener, { passive: true } as AddEventListenerOptions);
      this.#cleanups.push(() => target.removeEventListener(type, listener));
    };
    on(doc, "visibilitychange", () => this.#onVisibility());
    on(win, "pagehide", () => this.#leave(false));
    on(win, "pageshow", (event) => {
      if ((event as PageTransitionEvent).persisted) this.#beatSoon("visible");
    });
    on(win, "online", () => this.#beatSoon("visible"));
    on(win, "focus", () => {
      this.#onInput();
      const last = this.#lastBeatAt;
      if (last === null || this.#options.now() - last > FOCUS_AFTER_MS) this.#beatSoon("focus");
    });
    for (const type of INPUT_EVENTS) on(win, type, () => this.#onInput());
    this.#observeFrame();
    this.#beatSoon("load");
  }

  stop() {
    this.#leave(false);
    this.#started = false;
    this.#clearTimers();
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#observer?.disconnect();
    this.#observer = null;
  }

  setKeys(keys: Iterable<string>) {
    this.setItems([...keys].map((key) => ({ key, rev: null })));
  }

  // A change of keys is sent once they settle; a change of revisions only goes with the next beat
  // (it follows a reload the server's answer asked for).
  setItems(items: Iterable<WatchItem>) {
    const byKey = new Map<string, string | null>();
    for (const { key, rev } of items) if (!byKey.has(key) || rev !== null) byKey.set(key, rev);
    this.#items = [...byKey]
      .map(([key, rev]) => ({ key, rev }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, MAX_KEYS);
    const now = keysOf(this.#items);
    if (!this.#started || now === this.#sentKeys) return;
    if (this.#keysTimer) clearTimeout(this.#keysTimer);
    this.#keysTimer = setTimeout(() => {
      this.#keysTimer = null;
      if (keysOf(this.#items) !== this.#sentKeys) this.#beatSoon("nav");
    }, KEYS_SETTLE_MS);
  }

  /** The viewer signed for `safe`: the server checks that Safe soon. */
  signed(safe: string) {
    this.#lastInputAt = this.#options.now();
    void this.#beat("signed", { signed: { safe } });
  }

  #visible(): boolean {
    return this.#options.doc.visibilityState === "visible" && !this.#occluded;
  }

  #onVisibility() {
    if (!this.#visible()) {
      this.#leave(false);
      this.#report();
      return;
    }
    // Coming back to the tab is the viewer's doing, as an input is.
    this.#lastInputAt = this.#options.now();
    this.#setAway(false);
    this.#beatSoon("visible");
  }

  #onInput() {
    this.#lastInputAt = this.#options.now();
    if (!this.#away) return;
    this.#setAway(false);
    this.#beatSoon("resume");
  }

  #setAway(away: boolean) {
    if (this.#away === away) return;
    this.#away = away;
    this.#report();
  }

  #report() {
    this.#options.onState?.({
      away: this.#away,
      failing: this.#failures > 0,
      lastBeatAt: this.#lastBeatAt,
    });
  }

  /** Inside Safe{Wallet}'s frame, a frame that is not on screen counts as hidden. */
  #observeFrame() {
    const { win, doc } = this.#options;
    let framed = false;
    try {
      framed = win.self !== win.top;
    } catch {
      framed = true;
    }
    const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (!framed || typeof Observer !== "function") return;
    const observer = new Observer((entries: IntersectionObserverEntry[]) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const occluded = !entry.isIntersecting;
      if (occluded === this.#occluded) return;
      this.#occluded = occluded;
      this.#onVisibility();
    });
    observer.observe(doc.documentElement);
    this.#observer = observer;
  }

  #beatSoon(reason: PresenceReason) {
    void this.#beat(reason);
  }

  async #beat(reason: PresenceReason, extra: Record<string, unknown> = {}) {
    if (!this.#started) return;
    const now = this.#options.now();
    if (!this.#visible()) return;
    const { awayMs } = this.#options;
    if (reason === "interval" && awayMs > 0 && now - this.#lastInputAt > awayMs) {
      this.#setAway(true);
      this.#clearTimers();
      this.#leave(true);
      return;
    }
    if (this.#away) return;
    // One beat at a time; a beat that finds one in flight is folded into the next.
    if (this.#inFlight) return;
    this.#inFlight = true;
    this.#clearTimer();
    const items = this.#items;
    let next = BEAT_MS;
    let answer: Partial<BeatAnswer> | null = null;
    try {
      const response = await this.#options.fetch(this.#options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ tab: this.#tab, reason, items, ...extra }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      answer = (await response.json().catch(() => null)) as Partial<BeatAnswer> | null;
      this.#failures = 0;
      this.#present = true;
      this.#sentKeys = keysOf(items);
      this.#lastBeatAt = now;
      if (typeof answer?.nextMs === "number" && Number.isFinite(answer.nextMs))
        next = Math.min(MAX_NEXT_MS, Math.max(MIN_NEXT_MS, answer.nextMs));
    } catch {
      // The server is down or restarting: try again later and later (10, 20, 40, then 60 s).
      this.#failures++;
      next = Math.min(MAX_NEXT_MS, BEAT_MS * 2 ** this.#failures);
    } finally {
      this.#inFlight = false;
    }
    this.#report();
    if (answer) {
      try {
        this.#options.onAnswer?.(answer);
      } catch {
        // The page's handling of an answer is its own.
      }
    }
    if (!this.#started || !this.#visible() || this.#away) return;
    // Keys that changed while the beat was out go now.
    if (keysOf(this.#items) !== this.#sentKeys && this.#failures === 0) {
      this.#beatSoon("nav");
      return;
    }
    this.#schedule(next);
  }

  #schedule(ms: number) {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#beat("interval");
    }, ms);
  }

  #leave(away: boolean) {
    this.#clearTimer();
    if (!this.#present) return;
    this.#present = false;
    const body = JSON.stringify({ tab: this.#tab, reason: "leave", items: [], away });
    try {
      // keepalive lets it outlive the page (pagehide).
      void this.#options
        .fetch(this.#options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body,
        })
        .catch(() => {});
    } catch {
      try {
        this.#options.sendBeacon?.(
          this.#options.url,
          new Blob([body], { type: "application/json" })
        );
      } catch {
        // Lost: the server stops counting the tab SYNC_KEEPWARM_MS after its last beat anyway.
      }
    }
  }

  #clearTimer() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #clearTimers() {
    this.#clearTimer();
    if (this.#keysTimer) clearTimeout(this.#keysTimer);
    this.#keysTimer = null;
  }
}

export type ReloadOptions = {
  now?: () => number;
  revalidate: () => void;
  idle: () => boolean;
  statusChanged?: () => void;
  onHeld?: (waiting: boolean) => void;
};

/**
 * When to reload the page's data after the server said something changed: at once when nothing
 * stands in the way, merged (many changes, one reload), at most once every 5 s, a key the server
 * does not know at most once a minute, after a navigation or another reload ends, and while the
 * viewer is in the middle of something (holds), only once they are done. `force` (the viewer
 * asked, e.g. Fetch signatures) skips the 5 s, never a hold.
 */
export class Reloader {
  readonly #options: Required<Omit<ReloadOptions, "statusChanged" | "onHeld">> &
    Pick<ReloadOptions, "statusChanged" | "onHeld">;
  #dirty = false;
  #status = false;
  #force = false;
  #holds = 0;
  #last = Number.NEGATIVE_INFINITY;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #unknownAt = new Map<string, number>();

  constructor(options: ReloadOptions) {
    this.#options = { now: Date.now, ...options };
  }

  noteAnswer({ changed = [], unknown = [] }: { changed?: string[]; unknown?: string[] }) {
    const now = this.#options.now();
    const keys = [...changed];
    for (const key of unknown) {
      const at = this.#unknownAt.get(key);
      if (at !== undefined && now - at < UNKNOWN_EVERY_MS) continue;
      this.#unknownAt.set(key, now);
      keys.push(key);
    }
    // A reload still waiting (the tab was hidden meanwhile) goes once nothing stands in its way.
    if (keys.length === 0) {
      this.tryReload();
      return;
    }
    if (keys.includes("status")) this.#status = true;
    this.#dirty = true;
    this.tryReload();
  }

  force() {
    this.#dirty = true;
    this.#force = true;
    this.tryReload();
  }

  hold(): () => void {
    this.#holds++;
    if (this.#dirty) this.#options.onHeld?.(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holds--;
      if (this.#holds === 0) {
        this.#options.onHeld?.(false);
        this.tryReload();
      }
    };
  }

  tryReload() {
    if (!this.#dirty) return;
    if (this.#holds > 0) {
      this.#options.onHeld?.(true);
      return;
    }
    if (!this.#options.idle()) return;
    const now = this.#options.now();
    const wait = this.#force ? 0 : this.#last + RELOAD_GAP_MS - now;
    if (wait > 0) {
      if (!this.#timer)
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.tryReload();
        }, wait);
      return;
    }
    this.#dirty = false;
    this.#force = false;
    this.#last = now;
    if (this.#status) {
      this.#status = false;
      this.#options.statusChanged?.();
    }
    this.#options.revalidate();
  }

  get waiting(): boolean {
    return this.#dirty;
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** What beats tell about the server, for labels that need no request. */
export type LiveState = {
  head: BeatAnswer["head"];
  index: PuhIndexStatus | null;
  checked: Record<string, SafeCheck>;
  verifiedAt: BeatAnswer["verifiedAt"];
  notedAt: BeatAnswer["notedAt"];
  eraAt: BeatAnswer["eraAt"];
  simulatedAt: BeatAnswer["simulatedAt"];
  catchingUp: boolean;
  /** Paused: nobody touched the tab for the away cut-off (any input resumes). */
  away: boolean;
  /** Beats are not answered (the server is down or restarting). */
  failing: boolean;
  lastBeatAt: number | null;
  updating: boolean;
  /** A reload is waiting for the viewer to finish (a Sign dialog open, ...). */
  held: boolean;
};

const INITIAL: LiveState = {
  head: null,
  index: null,
  checked: {},
  verifiedAt: {},
  notedAt: {},
  eraAt: {},
  simulatedAt: {},
  catchingUp: false,
  away: false,
  failing: false,
  lastBeatAt: null,
  updating: false,
  held: false,
};

type PresenceContextValue = {
  register: (item: WatchItem) => () => void;
  signed: (safe: string) => void;
  hold: () => () => void;
  reload: () => void;
  applyCheck: (key: string, check: SafeCheck | null) => void;
};

const PresenceContext = createContext<PresenceContextValue>({
  register: () => () => {},
  signed: () => {},
  hold: () => () => {},
  reload: () => {},
  applyCheck: () => {},
});

const LiveContext = createContext<LiveState>(INITIAL);

export const INITIAL_LIVE: LiveState = INITIAL;

export const LiveStateProvider = LiveContext.Provider;

export function useWatchItem(item: WatchItem | null | undefined) {
  const { register } = useContext(PresenceContext);
  const key = item?.key ?? null;
  const rev = item?.rev ?? null;
  useEffect(() => (key ? register({ key, rev }) : undefined), [key, rev, register]);
}

export function useWatchKey(key: string | null | undefined) {
  useWatchItem(key ? { key, rev: null } : null);
}

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}

/**
 * While `active` (a Sign dialog open, a wallet request pending, a Safe transaction hash shown),
 * the page's data is not reloaded; returns whether a reload is waiting for it to end.
 */
export function useHoldUpdates(active: boolean): boolean {
  const { hold } = useContext(PresenceContext);
  const { held } = useContext(LiveContext);
  useEffect(() => (active ? hold() : undefined), [active, hold]);
  return active && held;
}

type SafeCheckState = { running: boolean; error: string | null; failed: number; at: number | null };

// "Fetch signatures" / "Check Safe now" for `key`, then a reload in place. A press while one runs
// does nothing more (the server joins it too).
export function useSafeCheck(key: string | null | undefined) {
  const { reload, applyCheck } = useContext(PresenceContext);
  const [state, setState] = useState<SafeCheckState>({
    running: false,
    error: null,
    failed: 0,
    at: null,
  });
  const running = useRef(false);
  const run = useCallback(async () => {
    if (!key || running.current) return;
    running.current = true;
    setState((s) => ({ ...s, running: true, error: null }));
    try {
      const response = await fetch(SAFE_CHECK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ key }),
      });
      const body = (await response.json().catch(() => null)) as {
        failed?: number;
        error?: string;
        check?: SafeCheck | null;
      } | null;
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setState({ running: false, error: null, failed: body?.failed ?? 0, at: Date.now() });
      // The label says the Safes were just checked at once (a list the check left as it was does
      // not reload at all), not with the next beat.
      if (body && body.check !== undefined) applyCheck(key, body.check);
      reload();
    } catch (error) {
      setState({
        running: false,
        // A fetch that got no answer at all (the app stopped, the network is down) says so, not
        // the browser's "Failed to fetch".
        error:
          error instanceof TypeError
            ? "the app is not answering; try again"
            : error instanceof Error
              ? error.message
              : String(error),
        failed: 0,
        at: Date.now(),
      });
    } finally {
      running.current = false;
    }
  }, [key, reload, applyCheck]);
  return { ...state, run };
}

type Watch = { key: string };

const isPromise = (value: unknown): value is Promise<unknown> =>
  !!value && typeof (value as { then?: unknown }).then === "function";

// The matched routes' loader items: keys (`watch`) and revisions (`revs`, deferred: in once the
// content is).
function useLoaderItems(): WatchItem[] {
  const matches = useMatches();
  const [resolved, setResolved] = useState<ReadonlyMap<unknown, WatchItem[]>>(new Map());
  useEffect(() => {
    let live = true;
    for (const match of matches) {
      const revs = (match.data as { revs?: unknown } | undefined)?.revs;
      if (Array.isArray(revs) || !isPromise(revs)) continue;
      revs.then(
        (items) => {
          if (!live || !Array.isArray(items)) return;
          setResolved((current) => {
            if (current.get(revs) === items) return current;
            // Only the current matches' revisions are kept (a reload or navigation since
            // replaced the others): the map never grows with the tab's age.
            const kept = new Set(
              matches.map((m) => (m.data as { revs?: unknown } | undefined)?.revs)
            );
            const next = new Map([...current].filter(([key]) => kept.has(key)));
            return next.set(revs, items);
          });
        },
        () => {}
      );
    }
    return () => {
      live = false;
    };
  }, [matches]);
  return useMemo(() => {
    const items: WatchItem[] = [];
    for (const match of matches) {
      const data = match.data as { watch?: unknown; revs?: unknown } | undefined;
      if (Array.isArray(data?.watch))
        for (const item of data.watch as Watch[])
          if (item && typeof item.key === "string") items.push({ key: item.key, rev: null });
      const revs = Array.isArray(data?.revs) ? data.revs : resolved.get(data?.revs);
      if (Array.isArray(revs))
        for (const item of revs as WatchItem[])
          if (item && typeof item.key === "string")
            items.push({ key: item.key, rev: typeof item.rev === "string" ? item.rev : null });
    }
    return items;
  }, [matches, resolved]);
}

export function PresenceProvider({ awayMs, children }: { awayMs: number; children: ReactNode }) {
  const loaderItems = useLoaderItems();
  const [registered, setRegistered] = useState<
    ReadonlyMap<string, { count: number; revs: (string | null)[] }>
  >(new Map());
  const beater = useRef<Beater | null>(null);
  const [live, setLive] = useState<LiveState>(INITIAL);
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const idle = useRef(true);
  idle.current = revalidator.state === "idle" && navigation.state === "idle";
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;
  const reloader = useRef<Reloader | null>(null);
  // Whether the reload running now is one this provider started (for "Updating…").
  const reloading = useRef(false);

  if (reloader.current === null)
    reloader.current = new Reloader({
      revalidate: () => {
        reloading.current = true;
        setLive((s) => (s.updating ? s : { ...s, updating: true }));
        revalidate.current();
      },
      // Never while the tab is hidden: a reload is a page load the server counts as use.
      idle: () =>
        idle.current &&
        (beater.current?.visible ??
          (typeof document === "undefined" || document.visibilityState === "visible")),
      statusChanged: requestStatusRevalidation,
      onHeld: (held) => setLive((s) => (s.held === held ? s : { ...s, held })),
    });

  // A navigation or a reload ended: a reload that waited for it goes now.
  useEffect(() => {
    if (revalidator.state !== "idle" || navigation.state !== "idle") return;
    if (reloading.current) {
      reloading.current = false;
      setLive((s) => (s.updating ? { ...s, updating: false } : s));
    }
    reloader.current?.tryReload();
  }, [revalidator.state, navigation.state]);

  const items = useMemo(() => {
    const byKey = new Map<string, string | null>();
    for (const { key, rev } of loaderItems)
      if (!byKey.has(key) || (rev !== null && byKey.get(key) === null)) byKey.set(key, rev);
    // A rendered item's revision is the one on screen.
    for (const [key, entry] of registered) {
      const rev = entry.revs.find((r) => r !== null) ?? null;
      if (!byKey.has(key) || rev !== null) byKey.set(key, rev);
    }
    return [...byKey].map(([key, rev]) => ({ key, rev }));
  }, [loaderItems, registered]);
  const current = useRef(items);
  current.current = items;

  useEffect(() => {
    const next = new Beater({
      awayMs,
      onAnswer: (answer) => {
        setLive((s) => ({
          ...s,
          head: answer.head ?? s.head,
          index: answer.index ?? s.index,
          checked: answer.checked ?? {},
          verifiedAt: answer.verifiedAt ?? {},
          notedAt: answer.notedAt ?? {},
          eraAt: answer.eraAt ?? {},
          simulatedAt: answer.simulatedAt ?? {},
          catchingUp: answer.catchingUp === true,
        }));
        reloader.current?.noteAnswer(answer);
      },
      onState: ({ away, failing, lastBeatAt }) => {
        setLive((s) =>
          s.away === away && s.failing === failing && s.lastBeatAt === lastBeatAt
            ? s
            : { ...s, away, failing, lastBeatAt }
        );
        // Visible again: a reload that waited while the tab was hidden goes now.
        if (next.visible) reloader.current?.tryReload();
      },
    });
    beater.current = next;
    next.setItems(current.current);
    next.start();
    return () => {
      next.stop();
      reloader.current?.stop();
      if (beater.current === next) beater.current = null;
    };
  }, [awayMs]);
  useEffect(() => {
    beater.current?.setItems(items);
  }, [items]);

  const register = useCallback(({ key, rev }: WatchItem) => {
    setRegistered((current) => {
      const next = new Map(current);
      const entry = next.get(key);
      next.set(key, { count: (entry?.count ?? 0) + 1, revs: [...(entry?.revs ?? []), rev] });
      return next;
    });
    return () =>
      setRegistered((current) => {
        const entry = current.get(key);
        const next = new Map(current);
        if (!entry || entry.count <= 1) next.delete(key);
        else {
          const revs = [...entry.revs];
          const at = revs.indexOf(rev);
          if (at >= 0) revs.splice(at, 1);
          next.set(key, { count: entry.count - 1, revs });
        }
        return next;
      });
  }, []);
  const signed = useCallback((safe: string) => beater.current?.signed(safe), []);
  const hold = useCallback(() => reloader.current?.hold() ?? (() => {}), []);
  const reload = useCallback(() => reloader.current?.force(), []);
  const applyCheck = useCallback((key: string, check: SafeCheck | null) => {
    setLive((s) => {
      const checked = { ...s.checked };
      if (check) checked[key] = check;
      else delete checked[key];
      return { ...s, checked };
    });
  }, []);
  const value = useMemo(
    () => ({ register, signed, hold, reload, applyCheck }),
    [register, signed, hold, reload, applyCheck]
  );
  return (
    <PresenceContext.Provider value={value}>
      <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
    </PresenceContext.Provider>
  );
}
