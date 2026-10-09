import { Await } from "@remix-run/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Suspense } from "react";
import type { Refresh } from "./freshness";

// Data a page shows before this run's log index has confirmed it, always labelled as such:
// - "last-run": from the history the app kept from its last run (.server/persist/chain-cache.ts),
//   while this run reads the chain again;
// - "direct": located directly (from an upgrade's creation time, or an emergency upgrade's state
//   over archive blocks) while this run's index is still reading the handler's history.
// The confirmed answer replaces it in the same response (or says it could not be confirmed).

export const LAST_RUN_LABEL = "History from last run · re-verifying";
export const DIRECT_LABEL = "Located directly · history index verifying";

/** Where an unconfirmed item came from. */
export type Provenance = "last-run" | "direct";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  "last-run": LAST_RUN_LABEL,
  direct: DIRECT_LABEL,
};

/** Which provenance an item from the server carries, or null once confirmed by this run's index. */
export function provenanceOf(item: {
  fromLastRun?: boolean;
  locatedDirectly?: boolean;
}): Provenance | null {
  if (item.fromLastRun) return "last-run";
  if (item.locatedDirectly) return "direct";
  return null;
}

/**
 * A notice above a list taken from the last run's history: re-verifying while the verified list
 * streams in ("pending"), and saying so when it could not be read ("failed").
 */
export function LastRunNote({ refresh, what }: { refresh: Refresh; what: string }) {
  const failed = refresh === "failed";
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
      data-testid="last-run"
    >
      {failed ? (
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Loader2
          aria-hidden
          className={`mt-0.5 h-4 w-4 shrink-0${refresh === "pending" ? " motion-safe:animate-spin" : ""}`}
        />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold">
          {failed ? "History from last run" : LAST_RUN_LABEL}
        </span>
        <span className="block text-xs">
          {what} come from the history this app saved in its last run and have not been read from
          the chain again yet.
          {refresh === "pending" && " The chain's current history replaces them when it arrives."}
        </span>
        {failed && (
          <span className="block font-medium">
            Reading the history again did not complete. Refresh the page to retry.
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Text that says where something came from, for an item this run's index has not confirmed yet:
 * `pending` while it is checked (`check`), `confirmed` once it has been, `failed` when it was not
 * (or could not be read). Without a check (found in this run's index): `confirmed`. Inline, for a
 * sentence such as a section's description.
 */
export function LastRunText({
  check,
  pending,
  confirmed,
  failed,
}: {
  check: Promise<unknown> | null;
  pending: string;
  confirmed: string;
  failed: string;
}) {
  if (!check) return <>{confirmed}</>;
  return (
    <Suspense fallback={pending}>
      <Await resolve={check} errorElement={failed}>
        {() => confirmed}
      </Await>
    </Suspense>
  );
}

/**
 * For one item this run's index has not confirmed yet (an upgrade's start, an emergency upgrade's
 * execution): a line saying where it came from while it is checked, nothing once it is confirmed,
 * and an alert when the index says otherwise (or could not be read).
 */
export function LastRunCheck({
  check,
  source = "last-run",
  what = "start",
}: {
  check: Promise<unknown>;
  source?: Provenance;
  what?: "start" | "execution";
}) {
  const mismatch =
    source === "last-run"
      ? `The chain's history could not confirm this ${what} from the last run. Reload the page.`
      : `The handler's complete log history could not confirm this ${what}, which was located directly. Do not rely on it; reload the page.`;
  return (
    <Suspense
      fallback={
        <span
          className="block text-amber-900 text-xs"
          data-testid="last-run-check"
          data-source={source}
        >
          {PROVENANCE_LABEL[source]}
        </span>
      }
    >
      <Await
        resolve={check}
        errorElement={
          <span
            role="alert"
            className="block font-medium text-red-800 text-xs"
            data-testid="last-run-mismatch"
          >
            {mismatch}
          </span>
        }
      >
        {() => null}
      </Await>
    </Suspense>
  );
}
