import { useMatches } from "@remix-run/react";
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

// While this tab is visible, it tells the server so every 10 s, with the keys of what it shows
// (POST /resources/presence, see sync/presence.ts): the app follows the chain only while some tab
// does, and only for what is on screen. A hidden tab (or one framed in Safe{Wallet} whose frame is
// hidden), a closed one, and one nobody touched for SYNC_AWAY_MS say they left and stop; the next
// look or input brings them back. Beats are plain fetches (never a Remix fetcher, which would
// revalidate the page after each), carry no part of the URL (its search string can hold ?sig=),
// and make the server send nothing upstream by themselves.

export const PRESENCE_URL = "/resources/presence";
/** How often a visible tab beats, unless the server says otherwise (2-60 s). */
export const BEAT_MS = 10_000;
const MIN_NEXT_MS = 2_000;
const MAX_NEXT_MS = 60_000;
/** Key changes (a navigation rendering) settle this long before they are sent. */
const KEYS_SETTLE_MS = 250;
/** A focus beats at once only when the last beat is older than this. */
const FOCUS_AFTER_MS = 5_000;
/** At most this many keys go in a beat (the server's limit). */
const MAX_KEYS = 32;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export type PresenceReason =
  | "load"
  | "interval"
  | "visible"
  | "nav"
  | "focus"
  | "signed"
  | "resume"
  | "leave";

export type BeaterOptions = {
  /** A visible tab nobody touched for this long stops beating (0: never). */
  awayMs: number;
  url?: string;
  fetch?: typeof fetch;
  sendBeacon?: (url: string, body: Blob) => boolean;
  now?: () => number;
  doc?: Document;
  win?: Window;
  /** The tab's id; default: a new random one for this page (tabId). */
  tab?: string;
};

/**
 * A new random id for this page, never kept: a browser's Duplicate Tab copies sessionStorage, and
 * two tabs sharing an id would overwrite each other's keys, and one's leave would end the other.
 * A reload gets a new id; the old page left on pagehide.
 */
function tabId(win: Window): string {
  return typeof win.crypto?.randomUUID === "function"
    ? win.crypto.randomUUID()
    : `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * The beating, outside React: one timer at most, listeners on the document and window, and a leave
 * when the tab is hidden, closed or its viewer away.
 */
export class Beater {
  readonly #options: Required<Omit<BeaterOptions, "tab" | "sendBeacon">> & {
    sendBeacon?: BeaterOptions["sendBeacon"];
  };
  readonly #tab: string;
  #keys: string[] = [];
  #sentKeys: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #keysTimer: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;
  #lastBeatAt: number | null = null;
  #lastInputAt: number;
  #away = false;
  // Framed (Safe{Wallet}) and the frame is not on screen.
  #occluded = false;
  // The server counts this tab now (it beat and has not left).
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

  /** Paused because nobody touched the tab for awayMs (any input resumes). */
  get away(): boolean {
    return this.#away;
  }

  /** Starts beating (at once, when visible). Idempotent. */
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

  /** Stops for good: leaves, and removes every timer and listener. */
  stop() {
    this.#leave(false);
    this.#started = false;
    this.#clearTimers();
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#observer?.disconnect();
    this.#observer = null;
  }

  /**
   * The keys of what the tab shows now; a change is sent once they settle (before start(): the
   * first beat carries them).
   */
  setKeys(keys: Iterable<string>) {
    this.#keys = [...new Set(keys)].sort().slice(0, MAX_KEYS);
    const now = this.#keys.join("\n");
    if (!this.#started || now === this.#sentKeys) return;
    if (this.#keysTimer) clearTimeout(this.#keysTimer);
    this.#keysTimer = setTimeout(() => {
      this.#keysTimer = null;
      if (this.#keys.join("\n") !== this.#sentKeys) this.#beatSoon("nav");
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
      return;
    }
    // Coming back to the tab is the viewer's doing, as an input is.
    this.#lastInputAt = this.#options.now();
    this.#away = false;
    this.#beatSoon("visible");
  }

  #onInput() {
    this.#lastInputAt = this.#options.now();
    if (!this.#away) return;
    this.#away = false;
    this.#beatSoon("resume");
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
      this.#away = true;
      this.#clearTimers();
      this.#leave(true);
      return;
    }
    if (this.#away) return;
    // One beat at a time; a beat that finds one in flight is folded into the next.
    if (this.#inFlight) return;
    this.#inFlight = true;
    this.#clearTimer();
    const keys = this.#keys;
    let next = BEAT_MS;
    try {
      const response = await this.#options.fetch(this.#options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          tab: this.#tab,
          reason,
          items: keys.map((key) => ({ key, rev: null })),
          ...extra,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const answer = (await response.json().catch(() => null)) as { nextMs?: unknown } | null;
      this.#failures = 0;
      this.#present = true;
      this.#sentKeys = keys.join("\n");
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
    if (!this.#started || !this.#visible() || this.#away) return;
    // Keys that changed while the beat was out go now.
    if (this.#keys.join("\n") !== this.#sentKeys && this.#failures === 0) {
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

  /** Tells the server this tab left (hidden, closed, away), without waiting for an answer. */
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

type PresenceContextValue = {
  /** A rendered item's key, on screen until the returned function is called. */
  register: (key: string) => () => void;
  /** The viewer signed for this Safe. */
  signed: (safe: string) => void;
};

const PresenceContext = createContext<PresenceContextValue>({
  register: () => () => {},
  signed: () => {},
});

/** Puts `key` on screen while the calling component is mounted (nothing for null). */
export function useWatchKey(key: string | null | undefined) {
  const { register } = useContext(PresenceContext);
  useEffect(() => (key ? register(key) : undefined), [key, register]);
}

/** The tab's presence: to report a signature the viewer just made. */
export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

type Watch = { key: string };

/** The keys the matched routes' loaders issued (`watch` in their data). */
function useLoaderKeys(): string[] {
  const matches = useMatches();
  return useMemo(() => {
    const keys: string[] = [];
    for (const match of matches) {
      const watch = (match.data as { watch?: unknown } | undefined)?.watch;
      if (!Array.isArray(watch)) continue;
      for (const item of watch as Watch[])
        if (item && typeof item.key === "string") keys.push(item.key);
    }
    return keys;
  }, [matches]);
}

/**
 * Beats while this tab is visible, with the keys its routes' loaders issued and those the items it
 * renders register (useWatchKey). In the root shell; renders nothing of its own.
 */
export function PresenceProvider({ awayMs, children }: { awayMs: number; children: ReactNode }) {
  const loaderKeys = useLoaderKeys();
  const [registered, setRegistered] = useState<ReadonlyMap<string, number>>(new Map());
  const beater = useRef<Beater | null>(null);
  const keys = useMemo(
    () => [...new Set([...loaderKeys, ...registered.keys()])],
    [loaderKeys, registered]
  );
  const current = useRef(keys);
  current.current = keys;

  useEffect(() => {
    const next = new Beater({ awayMs });
    beater.current = next;
    // The first beat carries what the page shows now.
    next.setKeys(current.current);
    next.start();
    return () => {
      next.stop();
      if (beater.current === next) beater.current = null;
    };
  }, [awayMs]);
  useEffect(() => {
    beater.current?.setKeys(keys);
  }, [keys]);

  const register = useCallback((key: string) => {
    setRegistered((current) => {
      const next = new Map(current);
      next.set(key, (next.get(key) ?? 0) + 1);
      return next;
    });
    return () =>
      setRegistered((current) => {
        const count = current.get(key) ?? 0;
        const next = new Map(current);
        if (count <= 1) next.delete(key);
        else next.set(key, count - 1);
        return next;
      });
  }, []);
  const signed = useCallback((safe: string) => beater.current?.signed(safe), []);
  const value = useMemo(() => ({ register, signed }), [register, signed]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
