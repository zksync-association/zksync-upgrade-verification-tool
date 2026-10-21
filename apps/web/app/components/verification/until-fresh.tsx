import { Await } from "@remix-run/react";
import { type ReactNode, Suspense } from "react";
import type { Refresh } from "./freshness";

// Always the same tree (Await renders at once for a value that is not a promise): a reload that
// turns a stale first answer into a current one keeps an open row or Sign dialog mounted. `fresh`
// resolving to null (nothing was stale after all) keeps the first answer.
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
  children: (fresh: T | null, refresh: Refresh) => ReactNode;
  failed?: ReactNode;
  /** What replaces a `fresh` value that is not current yet (`staleOf`). */
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
