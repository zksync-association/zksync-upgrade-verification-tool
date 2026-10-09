import { linkStore } from "../cache";
import type { SignatureSet } from "../signatures";

// What pages last showed as current, kept in this process's memory so that a page loaded after a
// pause can show it at once, labelled with the block it was read at, while the newest block is
// read.
//
// While nobody uses the app it sends nothing upstream (sync/presence.ts), so the first page after
// a pause finds no head in memory: its sections must read the newest block, and what they show at
// it, before they have anything to show (about half a second). So each section a page showed as
// current (read at the head it was served at: nothing from the last run's history, nothing
// located directly, no Safe copy older than the page rule allows, no supplied signature) is kept
// here under its key, with that head. A later page load that finds no head in memory shows it
// first, labelled "As of block #N" (components/verification/as-of.tsx): never in a passing colour,
// with nothing to sign or send from it, and the current answer replaces it in the same response.
//
// Only page loaders use this: JSON (/api/*) never does. Nothing here is written to disk, kept
// across a settings change, used on a dev node (which can be rewound), or sent upstream.

/** The head a kept answer was read at (decimal strings, as pages receive them). */
export type AsOf = { block: string; timestamp: string };

/** A kept answer as a page shows it first: the answer, with the head it was read at. */
export type ShownAsOf<T> = T & { asOf: AsOf };

type Head = { number: bigint; timestamp: bigint };

/** How this module reads the chain head: rpc.ts gives it as it loads (see provideHeads). */
export type HeadSource = {
  /** The head in memory right now, at once: null when none is, or its read has not answered. */
  servedHeadNow(): Head | null;
  /** The head requests read (rpc.ts latestBlock): joins a read in flight. */
  latestBlock(): Promise<Head>;
  /** The settings generation (rpc.ts rpcGeneration). */
  generation(): number;
  /** The node is a dev node (anvil, hardhat): its chain can be rewound. null while unknown. */
  isDevNode(): boolean | null;
};

let heads: HeadSource | null = null;

/**
 * Called by rpc.ts as it loads. A page loader decides, synchronously and before any of its reads
 * starts, whether it must wait for the newest block; the browser's tests of pages, which never
 * load rpc.ts, then find nothing kept.
 */
export function provideHeads(source: HeadSource | null) {
  heads = source;
}

type Kept = { value: unknown; asOf: AsOf; generation: number };

/** At most this many sections are kept (the least recently kept is dropped first). */
export const LAST_SHOWN_LIMIT = 48;

const kept = new Map<string, Kept>();

// A settings change (another RPC, maybe another chain) drops everything cached: so do these.
linkStore("last-shown:", (prefix) => {
  if (prefix === null) kept.clear();
});

/** Forgets what pages showed (tests). */
export function resetLastShown() {
  kept.clear();
}

/** How many sections are kept (tests). */
export function lastShownSize(): number {
  return kept.size;
}

type Decision = {
  /** No head in memory: the page's sections must read the newest block first. */
  waiting: boolean;
  /** The head the page's reads use (or an older one), for the label; null when unknown. */
  at: Promise<AsOf | null>;
  generation: number;
  currentGeneration: () => number;
};

const asOfOf = (head: Head): AsOf => ({
  block: head.number.toString(),
  timestamp: head.timestamp.toString(),
});

function decide(): Decision | null {
  const source = heads;
  // Unknown network (nothing read yet, so nothing kept either) or a dev node: nothing.
  if (!source || source.isDevNode() !== false) return null;
  const now = source.servedHeadNow();
  // With a head in memory, that head: the page's reads, which start after this, use it or a newer
  // one. Without one, the head read they all join (this one starts it when none is in flight).
  const at = (now ? Promise.resolve(now) : source.latestBlock()).then(asOfOf, () => null);
  return {
    waiting: now === null,
    at,
    generation: source.generation(),
    currentGeneration: source.generation,
  };
}

/**
 * For a page loader, called as it starts, before its sections start reading: whether the page
 * must wait for the newest block, and for each of its sections, what it last showed (`held`), the
 * keeping of what it shows now (`keep`), or both around a section's first answer and the current
 * one after it (`section`).
 */
export function lastShown() {
  const decision = decide();

  /**
   * What a page last showed as current under `key`, with the head it was read at, when no head
   * is in memory now; otherwise (or when nothing is kept, on a dev node, after a settings change)
   * null. Resolved at once: it never waits on anything upstream.
   */
  function held<T>(key: string): Promise<ShownAsOf<T> | null> {
    if (!decision?.waiting) return Promise.resolve(null);
    const found = kept.get(key);
    if (!found || found.generation !== decision.generation) return Promise.resolve(null);
    return Promise.resolve({ ...(found.value as T), asOf: found.asOf });
  }

  /**
   * Keeps `answer` under `key` once it resolves, when `current` says it is current (read at the
   * head served, nothing older or unconfirmed in it), with the head this page's reads used.
   * Nothing is kept from an answer that fails, or after a settings change.
   */
  function keep<T>(key: string, answer: Promise<T>, current: (value: T) => boolean) {
    if (!decision) {
      void answer.catch(() => {});
      return;
    }
    const d = decision;
    void answer
      .then(async (value) => {
        if (!current(value)) return;
        const asOf = await d.at;
        if (!asOf || d.currentGeneration() !== d.generation) return;
        kept.delete(key);
        kept.set(key, { value, asOf, generation: d.generation });
        while (kept.size > LAST_SHOWN_LIMIT) kept.delete(kept.keys().next().value as string);
      })
      .catch(() => {});
  }

  /**
   * A section's `first` answer and the `fresh` one after it (null when the first is current), as
   * the page shows them: when no head is in memory and the section showed something before, that
   * comes first (`label`led, with `asOf`) and the current answer after it; otherwise `first` and
   * `fresh` as they are. The current answer (fresh, else first) is kept when `current` says so.
   *
   * `early` (a section fed by Safe, whose fresh answer waits on Safe's reads): the held answer is
   * replaced by the current first answer as soon as it is in (labelled with its older Safe copies
   * by itself), and that by the fresh one (`after`, see UntilFresh); otherwise the held answer
   * stays until the fresh one is in. Without a held answer `after` is null.
   */
  function section<T>(
    key: string,
    first: Promise<T>,
    fresh: Promise<T | null>,
    {
      current,
      label = (value) => value,
      early = false,
    }: {
      current: (value: T) => boolean;
      label?: (value: T, asOf: AsOf) => T;
      early?: boolean;
    }
  ): {
    first: Promise<T & { asOf?: AsOf }>;
    fresh: Promise<(T & { asOf?: AsOf }) | null>;
    after: Promise<(T & { asOf?: AsOf }) | null>;
  } {
    const answer = Promise.all([first, fresh]).then(([f, r]) => r ?? f);
    keep(key, answer, current);
    const shown = held<T>(key);
    type Shown = T & { asOf?: AsOf };
    const result = {
      first: shown.then((s): Promise<Shown> | Shown =>
        s ? { ...label(s, s.asOf), asOf: s.asOf } : (first as Promise<Shown>)
      ),
      // (Never with `asOf`: typed as `first` is, so a page renders either with the same code.)
      fresh: shown.then((s) => (s ? (early ? first : answer) : fresh)) as Promise<Shown | null>,
      after: shown.then((s) => (s && early ? fresh : null)) as Promise<Shown | null>,
    };
    void result.first.catch(() => {});
    void result.fresh.catch(() => {});
    void result.after.catch(() => {});
    return result;
  }

  return { held, keep, section };
}

/**
 * The page rule's floor: a page's current answer uses a member Safe's copy at most this old
 * without asking Safe (.server/safe/store.ts SAFE_LISTING_MAX_AGE_MS, the same value: a test
 * checks it; this module cannot load the store, which loads rpc.ts, which loads this module).
 */
export const PAGE_COPY_MS = 60_000;

/**
 * Whether the current answer for a set a page shows before it (a stale first answer, or the set
 * as last shown) reads Safe again, so that its Safe copies may be said to be refreshing: only for
 * a set that can still be signed (`open`: for one that cannot, the page keeps any copy it holds,
 * see .server/signatures.ts pageSource), with a member Safe whose signature is not valid in it,
 * when its copies are older than the page rule's floor (or none was read). Otherwise the current
 * answer uses the same copies, and only their age is said.
 */
export function rereadsSafe(
  set: Pick<SignatureSet, "members" | "safeFetchedAt">,
  open: boolean,
  now = Date.now()
): boolean {
  if (!open || !set.members.some((m) => m.safe.isContract && m.status !== "valid")) return false;
  const at = set.safeFetchedAt ? Date.parse(set.safeFetchedAt) : Number.NaN;
  return Number.isNaN(at) || now - at > PAGE_COPY_MS;
}

/**
 * A set a page kept (see `keep`), as the page shows it first after a pause: not current
 * (`stale`, as of the block it was verified at; no head to name for its re-verification yet),
 * never followed under its key or reported with Safe checks, and whether its copies are being
 * refreshed (rereadsSafe). Its card shows nothing in a passing colour and nothing to sign or send.
 */
export function heldSet<S extends SignatureSet>(set: S, open: boolean) {
  return {
    ...set,
    stale: true,
    reverifyingAt: null,
    watch: undefined,
    safeCheck: null,
    rereadsSafe: rereadsSafe(set, open),
  };
}
