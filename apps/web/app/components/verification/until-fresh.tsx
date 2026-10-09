import { Await } from "@remix-run/react";
import { type ReactNode, Suspense } from "react";
import type { Refresh } from "./freshness";

/**
 * A page's first answer until the fresh result streams in (see .server/signatures.ts
 * firstSignatureSet). A first answer that is not stale renders as it is. A stale one renders with
 * refresh "pending" until `fresh` resolves, then the fresh value renders in its place; when `fresh`
 * fails, the stale one stays with refresh "failed" (or `failed` renders, when given: the page's
 * own error for what could not be read). `fresh` resolving to null (nothing was stale after all)
 * keeps the first answer.
 *
 * After a pause the first answer is what the page last showed (as of its block), and the value
 * that replaces it may itself not be current yet (the current answer from older Safe copies,
 * `staleOf`): it then renders as a first answer does, with refresh "pending", until `after`
 * replaces it (or "failed" when that fails, the value staying, labelled as it is).
 *
 * The tree is the same either way (a Suspense around an Await, which renders at once for a value
 * that is not a promise): when a reload of the page turns a stale first answer into a current one
 * (or back), React keeps what is inside mounted, so an expanded member row, an open details panel
 * or an open Sign dialog stay as they were.
 */
export function UntilFresh<T>({
  stale,
  fresh,
  children,
  failed,
  after,
  staleOf,
}: {
  stale: boolean;
  fresh: Promise<T | null> | T | null;
  /** `refresh` is null whenever the value given is current. */
  children: (fresh: T | null, refresh: Refresh) => ReactNode;
  /** What renders when `fresh` fails (default: the first answer, with refresh "failed"). */
  failed?: ReactNode;
  /** What replaces a `fresh` value that is not current yet (see above). */
  after?: Promise<T | null> | T | null;
  staleOf?: (value: T) => boolean;
}) {
  return (
    <Suspense fallback={children(null, stale ? "pending" : null)}>
      <Await resolve={stale ? fresh : null} errorElement={failed ?? children(null, "failed")}>
        {(value) => {
          const next = stale ? ((value ?? null) as T | null) : null;
          if (next !== null && after !== undefined && staleOf?.(next))
            return (
              <UntilFresh stale fresh={after}>
                {(current, refresh) => children(current ?? next, current ? null : refresh)}
              </UntilFresh>
            );
          return children(next, null);
        }}
      </Await>
    </Suspense>
  );
}
