import { linkStore } from "../cache";
import type { SignatureSet } from "../signatures";

// What pages last showed as current (read at the head served: nothing from the last run's history
// or located directly, no Safe copy older than the page rule allows, no supplied signature), kept
// in memory so that a page loaded after a pause, with no head in memory yet, shows it at once,
// labelled "As of block #N": never in a passing colour, nothing to sign or send from it, and the
// current answer replaces it in the same response. Page loaders only (never JSON); never written
// to disk, kept across a settings change, used on a dev node (it can be rewound), or sent upstream.

export type AsOf = { block: string; timestamp: string };

export type ShownAsOf<T> = T & { asOf: AsOf };

type Head = { number: bigint; timestamp: bigint };

export type HeadSource = {
  servedHeadNow(): Head | null;
  latestBlock(): Promise<Head>;
  generation(): number;
  isDevNode(): boolean | null;
};

let heads: HeadSource | null = null;

// Called by rpc.ts as it loads: a page loader decides synchronously whether to wait for the head.
export function provideHeads(source: HeadSource | null) {
  heads = source;
}

type Kept = { value: unknown; asOf: AsOf; generation: number };

export const LAST_SHOWN_LIMIT = 48;

const kept = new Map<string, Kept>();

linkStore("last-shown:", (prefix) => {
  if (prefix === null) kept.clear();
});

export function resetLastShown() {
  kept.clear();
}

export function lastShownSize(): number {
  return kept.size;
}

type Decision = {
  waiting: boolean;
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
  if (!source || source.isDevNode() !== false) return null;
  const now = source.servedHeadNow();
  // The head in memory (the reads, starting after this, use it or newer), else the read they join.
  const at = (now ? Promise.resolve(now) : source.latestBlock()).then(asOfOf, () => null);
  return {
    waiting: now === null,
    at,
    generation: source.generation(),
    currentGeneration: source.generation,
  };
}

/** For a page loader: call it as the loader starts, before its sections start reading. */
export function lastShown() {
  const decision = decide();

  function held<T>(key: string): Promise<ShownAsOf<T> | null> {
    if (!decision?.waiting) return Promise.resolve(null);
    const found = kept.get(key);
    if (!found || found.generation !== decision.generation) return Promise.resolve(null);
    return Promise.resolve({ ...(found.value as T), asOf: found.asOf });
  }

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

  // What the section showed before comes first (labelled, with `asOf`), then the current answer;
  // `early` (fed by Safe): the current first answer replaces it once in; `after` is the fresh one.
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

// The value of safe/store.ts SAFE_LISTING_MAX_AGE_MS (a test checks it): this module cannot load
// the store, which loads rpc.ts, which loads this module.
export const PAGE_COPY_MS = 60_000;

/** Whether the current answer reads Safe again: only then are the copies shown said to refresh. */
export function rereadsSafe(
  set: Pick<SignatureSet, "members" | "safeFetchedAt">,
  open: boolean,
  now = Date.now()
): boolean {
  if (!open || !set.members.some((m) => m.safe.isContract && m.status !== "valid")) return false;
  const at = set.safeFetchedAt ? Date.parse(set.safeFetchedAt) : Number.NaN;
  return Number.isNaN(at) || now - at > PAGE_COPY_MS;
}

/** A kept set shown first after a pause: stale (nothing in a passing colour, nothing to sign). */
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
