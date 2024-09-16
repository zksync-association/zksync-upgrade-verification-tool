import type { IntRange } from "./dappwright.js";

export async function repeatFor<T>(numbers: T[], action: (n: T) => Promise<void>) {
  for (const n of numbers) {
    await action(n);
  }
}

function genericRange<From extends number, To extends number>(
  from: IntRange<From, To>,
  to: IntRange<From, To>
): IntRange<From, To>[] {
  const res = [];
  let last = from;
  while (last <= to) {
    res.push(last);
    last = (last + 1) as IntRange<From, To>;
  }
  return res as IntRange<From, To>[];
}

export const councilRange = genericRange<1, 12>;
export const guardianRange = genericRange<1, 8>;
