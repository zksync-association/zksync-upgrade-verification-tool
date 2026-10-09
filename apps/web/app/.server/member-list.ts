import { type Address, getAddress } from "viem";

/** Probe array getters in bounded batches; only the contiguous successful prefix is used. */
export async function readMemberList(
  read: (index: bigint) => Promise<Address>
): Promise<Address[]> {
  const members: Address[] = [];
  for (let offset = 0; offset < 64; offset += 16) {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => read(BigInt(offset + i)))
    );
    for (const result of results) {
      if (result.status === "rejected") return members;
      members.push(getAddress(result.value));
    }
  }
  return members;
}
