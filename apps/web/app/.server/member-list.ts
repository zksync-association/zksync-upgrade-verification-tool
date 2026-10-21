import { type Address, getAddress } from "viem";
import { classify } from "./chain/call";

/**
 * Probe array getters in bounded batches; only the contiguous successful prefix is used. The list
 * ends at the first index whose getter definitely reverts (out of bounds). Any other failure (an
 * RPC error, out of gas, an empty result) fails the read: a flaky RPC must never shorten the list.
 *
 * `confirm`, when given, asks a failed index again (directly, where `read` is batched through
 * Multicall3, whose failures carry no reason); only its answer decides. Indices after the end of
 * the list are never confirmed.
 */
export async function readMemberList(
  read: (index: bigint) => Promise<Address>,
  confirm?: (index: bigint) => Promise<Address>
): Promise<Address[]> {
  const members: Address[] = [];
  for (let offset = 0; offset < 64; offset += 16) {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => read(BigInt(offset + i)))
    );
    for (const [i, result] of results.entries()) {
      let answer = result;
      if (answer.status === "rejected" && confirm) {
        [answer] = await Promise.allSettled([confirm(BigInt(offset + i))]);
      }
      if (answer.status === "rejected") {
        if (classify(answer.reason) === "revert") return members;
        throw answer.reason;
      }
      members.push(getAddress(answer.value));
    }
  }
  return members;
}
