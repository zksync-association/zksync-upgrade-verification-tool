import type { Collected } from "./messages";

// Pages may show members' Safe copies older than 60 s, labelled with their age, while the fresh
// listings are read: Safe data is only candidate input, so old copies can only under-report.

export async function firstFromHeld<T>(
  held: Promise<Collected | null>,
  fresh: Promise<T>,
  from: (collected: Collected) => Promise<T> | T
): Promise<T> {
  let freshIn = false;
  fresh.then(
    () => {
      freshIn = true;
    },
    () => {}
  );
  const collected = await held.catch(() => null);
  if (!collected?.stale || freshIn) return fresh;
  const early = await Promise.resolve(collected)
    .then(from)
    .then(
      (value) => ({ value }),
      () => null
    );
  return early === null || freshIn ? fresh : early.value;
}
