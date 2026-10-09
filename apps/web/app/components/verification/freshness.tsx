import { useNowSeconds } from "@/components/sync-state";
import { formatAge, formatNumber, formatTime } from "@/utils/format";
import { AlertTriangle, Loader2 } from "lucide-react";

// Where a signature set's data came from and how old it is. Every set says the block its verdicts
// were read at and when Safe's copies were read. A page's first answer may be stale (`stale`: an
// older block's verdicts, or Safe copies older than 60 s, see .server/signatures.ts
// firstSignatureSet); it says so prominently until the fresh result replaces it.

/**
 * Where the fresh result is, for a stale first answer on screen: "pending" while it streams in,
 * "failed" when it could not be computed (the first answer then stays, saying so). null otherwise.
 */
export type Refresh = "pending" | "failed" | null;

/** What a set (or list) says about its own freshness (see SignatureSet). */
export type Labelled = {
  verifiedAtBlock?: string | null;
  safeFetchedAt?: string | null;
  stale?: boolean;
  reverifyingAt?: string | null;
};

/**
 * How old a Safe copy is: "12s ago" by this browser's clock, or the time it was read until that
 * clock is known (the server render and hydration must match).
 */
export function copiesAge(fetchedAt: string, nowSeconds: number | null): string {
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return "an unknown time";
  return nowSeconds === null ? formatTime(fetchedAt) : formatAge(nowSeconds - ms / 1000);
}

/**
 * The labels: "Verified at block #N" (+ " · re-verifying at #M" while the fresh result is
 * pending), "Safe copies from 12s ago" (+ " · refreshing"), and a line when re-verification
 * failed. null for a label the set has nothing for (a dev node's 'latest', no Safe copy read).
 */
export function freshnessLabels(set: Labelled, refresh: Refresh, nowSeconds: number | null) {
  const block = set.verifiedAtBlock ?? null;
  const at =
    set.reverifyingAt && set.reverifyingAt !== block
      ? ` at #${formatNumber(set.reverifyingAt)}`
      : "";
  const pending = refresh === "pending";
  return {
    verified:
      block === null
        ? null
        : `Verified at block #${formatNumber(block)}${pending ? ` · re-verifying${at}` : ""}`,
    copies: set.safeFetchedAt
      ? `Safe copies from ${copiesAge(set.safeFetchedAt, nowSeconds)}${pending ? " · refreshing" : ""}`
      : null,
    failed:
      refresh === "failed" ? "Checking again did not complete. Refresh the page to retry." : null,
  };
}

/**
 * A set's freshness: one quiet line for a fresh result; for a stale first answer, a notice that
 * names its block first, so no status below reads as a current pass.
 */
export function FreshnessNote({
  set,
  refresh = null,
  what = "Statuses below",
}: {
  set: Labelled;
  refresh?: Refresh;
  /** What the notice speaks for. */
  what?: string;
}) {
  const now = useNowSeconds();
  const labels = freshnessLabels(set, refresh, now);
  if (!set.stale) {
    const line = [labels.verified, labels.copies].filter(Boolean).join(" · ");
    return line ? (
      <p className="text-slate-600 text-xs" data-testid="set-freshness">
        {line}
      </p>
    ) : null;
  }
  // The block first when there is one (a verdict), else the copies' age (a list from Safe).
  const headline = labels.verified ?? labels.copies ?? "An earlier result";
  const asOf = labels.verified ? "that block and those Safe copies" : "those Safe copies";
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
      data-testid="set-stale"
    >
      {refresh === "failed" ? (
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Loader2
          aria-hidden
          className={`mt-0.5 h-4 w-4 shrink-0${refresh === "pending" ? " motion-safe:animate-spin" : ""}`}
        />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold">{headline}</span>
        {labels.verified && labels.copies && <span className="block">{labels.copies}</span>}
        <span className="block text-xs">
          {what} are as of {asOf}, not the current state.
          {refresh === "pending" && " The current check replaces them when it arrives."}
        </span>
        {labels.failed && <span className="block font-medium">{labels.failed}</span>}
      </span>
    </div>
  );
}
