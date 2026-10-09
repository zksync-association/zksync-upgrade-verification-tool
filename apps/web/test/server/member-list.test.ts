import { readMemberList } from "@/.server/member-list";
import { type Address, getAddress } from "viem";
import { expect, it } from "vitest";

const member = (i: number) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`);

it("reads members concurrently, preserving contract index order despite response order", async () => {
  const pending: ((value: Address) => void)[] = [];
  const result = readMemberList((i) =>
    i < 8n
      ? new Promise<Address>((resolve) => {
          pending[Number(i)] = resolve;
        })
      : Promise.reject(new Error("bounds"))
  );
  expect(pending).toHaveLength(8);
  for (let i = 7; i >= 0; i--) {
    const resolve = pending[i];
    if (!resolve) throw new Error(`Missing concurrent member read ${i}`);
    resolve(member(i));
  }
  expect(await result).toEqual(Array.from({ length: 8 }, (_, i) => member(i)));
});

it("stops at the first failed index instead of accepting later successes", async () => {
  const members = await readMemberList(async (i) => {
    if (i === 2n) throw new Error("RPC failed");
    return member(Number(i));
  });
  expect(members).toEqual([member(0), member(1)]);
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
