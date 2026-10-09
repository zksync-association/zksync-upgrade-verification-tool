import { CallReverted, UndecodableResult, UpstreamError } from "@/.server/chain/call";
import { readMemberList } from "@/.server/member-list";
import { type Address, getAddress } from "viem";
import { expect, it } from "vitest";

const member = (i: number) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`);
// members(i) past the end: Panic(0x32), a definite revert.
const outOfBounds = () => new CallReverted("Panic(0x32)", "0x4e487b71", 3);

it("reads members concurrently, preserving contract index order despite response order", async () => {
  const pending: ((value: Address) => void)[] = [];
  const result = readMemberList((i) =>
    i < 8n
      ? new Promise<Address>((resolve) => {
          pending[Number(i)] = resolve;
        })
      : Promise.reject(outOfBounds())
  );
  expect(pending).toHaveLength(8);
  for (let i = 7; i >= 0; i--) {
    const resolve = pending[i];
    if (!resolve) throw new Error(`Missing concurrent member read ${i}`);
    resolve(member(i));
  }
  expect(await result).toEqual(Array.from({ length: 8 }, (_, i) => member(i)));
});

it("stops at the first definitely reverting index instead of accepting later successes", async () => {
  const members = await readMemberList(async (i) => {
    if (i === 2n) throw outOfBounds();
    return member(Number(i));
  });
  expect(members).toEqual([member(0), member(1)]);
});

it.each([
  ["an RPC failure (-32603)", () => new UpstreamError("internal error (JSON-RPC error -32603)")],
  ["an empty result", () => new UndecodableResult("members() returned no data")],
  ["a plain error", () => new Error("socket hang up")],
])("fails on %s instead of shortening the list", async (_name, error) => {
  const failure = error();
  await expect(
    readMemberList(async (i) => {
      if (i === 2n) throw failure;
      if (i >= 8n) throw outOfBounds();
      return member(Number(i));
    })
  ).rejects.toBe(failure);
});

it("ignores failures past the end of the list", async () => {
  const members = await readMemberList(async (i) => {
    if (i === 3n) throw outOfBounds();
    if (i > 3n) throw new UpstreamError("timed out");
    return member(Number(i));
  });
  expect(members).toHaveLength(3);
});

it("bounds untrusted getters to 64 reads", async () => {
  let calls = 0;
  const members = await readMemberList(async (i) => {
    calls++;
    return member(Number(i));
  });
  expect(members).toHaveLength(64);
  expect(calls).toBe(64);
});

it("asks only the first failed index again, and lets that answer decide", async () => {
  // Batched reads fail past the end (and at 1, e.g. out of gas inside Multicall3).
  const confirmed: bigint[] = [];
  const members = await readMemberList(
    async (i) => {
      if (i === 1n || i >= 3n) throw new Error("aggregate3 sub-call failed (0x)");
      return member(Number(i));
    },
    async (i) => {
      confirmed.push(i);
      if (i >= 3n) throw outOfBounds();
      return member(Number(i));
    }
  );
  expect(members).toEqual([member(0), member(1), member(2)]);
  expect(confirmed).toEqual([1n, 3n]);
});

it("fails when the confirming read fails instead of reverting", async () => {
  const failure = new UpstreamError("internal error (JSON-RPC error -32603)");
  await expect(
    readMemberList(
      async (i) => {
        if (i >= 2n) throw new Error("aggregate3 sub-call failed (0x)");
        return member(Number(i));
      },
      async () => {
        throw failure;
      }
    )
  ).rejects.toBe(failure);
});
