import { Await } from "@remix-run/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Suspense } from "react";
import type { Refresh } from "./freshness";

// Data from the history the app kept from its last run (.server/persist/chain-cache.ts), shown on
// a page while this run reads the chain again. It is always labelled as such; the verified answer
// replaces it in the same response (or says it could not be read).

export const LAST_RUN_LABEL = "History from last run · re-verifying";

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
 * Text that says where something came from, for an item found in the last run's history: `pending`
 * while this run's history is checked (`check`), `confirmed` once it has confirmed it, `failed` when
 * it did not (or could not be read). Without a check (found in this run's history): `confirmed`.
 * Inline, for a sentence such as a section's description.
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
 * For one item found in the last run's history (an upgrade's start): a line while this run
 * confirms it, nothing once it has, and an alert when this run's history says otherwise (or
 * could not be read).
 */
export function LastRunCheck({ check }: { check: Promise<unknown> }) {
  return (
    <Suspense
      fallback={
        <span className="block text-amber-900 text-xs" data-testid="last-run-check">
          {LAST_RUN_LABEL}
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
            The chain's history could not confirm this start from the last run. Reload the page.
          </span>
        }
      >
        {() => null}
      </Await>
    </Suspense>
  );
}
