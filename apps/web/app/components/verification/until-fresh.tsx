import { Await } from "@remix-run/react";
import { type ReactNode, Suspense } from "react";
import type { Refresh } from "./freshness";

/**
 * A page's first answer until the fresh result streams in (see .server/signatures.ts
 * firstSignatureSet). A first answer that is not stale renders as it is. A stale one renders with
 * refresh "pending" until `fresh` resolves, then the fresh value renders in its place; when `fresh`
 * fails, the stale one stays with refresh "failed". `fresh` resolving to null (nothing was stale
 * after all) keeps the first answer.
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
}: {
  stale: boolean;
  fresh: Promise<T | null> | T | null;
  children: (fresh: T | null, refresh: Refresh) => ReactNode;
}) {
  return (
    <Suspense fallback={children(null, stale ? "pending" : null)}>
      <Await resolve={stale ? fresh : null} errorElement={children(null, "failed")}>
        {(value) => children(stale ? ((value ?? null) as T | null) : null, null)}
      </Await>
    </Suspense>
  );
}
