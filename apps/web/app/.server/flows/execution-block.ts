/** Locate a permanent false→true state transition with bounded parallel archive reads. */
export async function firstExecutedBlock(
  read: (block: bigint) => Promise<boolean>,
  from: bigint,
  to: bigint
): Promise<bigint | null> {
  if (from < 0n || to < from) throw new RangeError("Invalid execution search bounds");
  if (!(await read(to))) return null;
  if (await read(from)) return from;
  let low = from;
  let high = to;
  while (high - low > 1n) {
    const count = Number(high - low - 1n < 8n ? high - low - 1n : 8n);
    const points = Array.from(
      { length: count },
      (_, i) => low + ((high - low) * BigInt(i + 1)) / BigInt(count + 1)
    );
    const values = await Promise.all(points.map(read));
    let seenTrue = false;
    for (const value of values) {
      if (seenTrue && !value)
        throw new Error("Execution state is not monotonic; cannot locate its block safely");
      seenTrue ||= value;
    }
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (point === undefined) throw new Error("Missing execution search point");
      if (values[i]) {
        high = point;
        break;
      }
      low = point;
    }
  }
  return high;
}
