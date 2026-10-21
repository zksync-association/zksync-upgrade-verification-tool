import { firstExecutedBlock } from "@/.server/flows/execution-block";
import { expect, it, vi } from "vitest";

it.each([0n, 1n, 9n, 50n, 99n, 100n])(
  "finds the exact permanent transition at %s",
  async (transition) => {
    expect(await firstExecutedBlock(async (block) => block >= transition, 0n, 100n)).toBe(
      transition
    );
  }
);

it("classifies an unexecuted id with only the current state read", async () => {
  const read = vi.fn(async () => false);
  expect(await firstExecutedBlock(read, 0n, 100n)).toBeNull();
  expect(read.mock.calls).toEqual([[100n]]);
});

it("narrows millions of blocks in bounded parallel rounds", async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const result = await firstExecutedBlock(
    async (block) => {
      calls++;
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      return block >= 25_766_164n;
    },
    21_788_382n,
    26_128_706n
  );
  expect(result).toBe(25_766_164n);
  expect(maximum).toBe(8);
  expect(calls).toBeLessThanOrEqual(58);
});

it("propagates unavailable archive state rather than guessing an execution block", async () => {
  await expect(
    firstExecutedBlock(
      async (block) => {
        if (block === 100n) return true;
        throw new Error("archive unavailable");
      },
      0n,
      100n
    )
  ).rejects.toThrow("archive unavailable");
});

it("rejects contradictory historical states and invalid bounds", async () => {
  await expect(
    firstExecutedBlock(async (block) => block === 100n || block === 11n, 0n, 100n)
  ).rejects.toThrow("not monotonic");
  await expect(firstExecutedBlock(async () => true, 5n, 4n)).rejects.toThrow(RangeError);
});
