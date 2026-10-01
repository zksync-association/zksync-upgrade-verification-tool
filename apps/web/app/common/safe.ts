import {
  type Address,
  type Hex,
  getAddress,
  hashDomain,
  hashMessage,
  hashStruct,
  hashTypedData,
  hexToBigInt,
  hexToNumber,
  recoverAddress,
  size,
  slice,
} from "viem";

// A Safe signs a governance digest by wrapping it in its own EIP-712 "SafeMessage". This is what an
// owner's hardware wallet is asked to sign, so these are the hashes a signer compares on-device:
//   domainHash      Safe's EIP712Domain(chainId, verifyingContract = Safe)  — Ledger "Domain hash"
//   messageHash     hashStruct(SafeMessage(bytes message = digest))         — Ledger "Message hash"
//   safeMessageHash keccak256(0x1901 ‖ domainHash ‖ messageHash)             — what the key signs,
//                   and the id Safe{Wallet} and the Transaction Service use for the message.
// Valid for Safe v1.3.0+ (chainId in the domain). Each Safe's domainSeparator() is also read
// on-chain and compared, so an older Safe can't silently get the wrong hashes.

const SAFE_MESSAGE_TYPES = { SafeMessage: [{ name: "message", type: "bytes" }] } as const;
const SAFE_DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

export type SafeMessageHashes = { domainHash: Hex; messageHash: Hex; safeMessageHash: Hex };

export function safeMessageHashes(chainId: number, safe: Address, digest: Hex): SafeMessageHashes {
  const domain = { chainId, verifyingContract: safe };
  return {
    domainHash: hashDomain({ domain, types: SAFE_DOMAIN_TYPES }),
    messageHash: hashStruct({
      data: { message: digest },
      primaryType: "SafeMessage",
      types: SAFE_MESSAGE_TYPES,
    }),
    safeMessageHash: hashTypedData({
      domain,
      types: SAFE_MESSAGE_TYPES,
      primaryType: "SafeMessage",
      message: { message: digest },
    }),
  };
}

export type RecoveredOwner = {
  owner: Address;
  kind: "eoa" | "eth_sign" | "contract" | "approved-hash";
};

/**
 * Owners whose signatures make up a Safe signature blob (Safe's checkNSignatures encoding).
 * Informational only: whether the blob is valid is decided on-chain.
 */
export async function recoverSafeOwners(
  safeMessageHash: Hex,
  signature: Hex
): Promise<RecoveredOwner[]> {
  const owners: RecoveredOwner[] = [];
  const length = size(signature);
  // Contract signatures keep their payload after the static 65-byte parts; stop before it.
  let staticEnd = length;
  for (let i = 0; i + 65 <= staticEnd; i += 65) {
    const r = slice(signature, i, i + 32);
    const s = slice(signature, i + 32, i + 64);
    const v = hexToNumber(slice(signature, i + 64, i + 65));
    try {
      if (v === 0 || v === 1) {
        owners.push({
          owner: getAddress(slice(r, 12)),
          kind: v === 0 ? "contract" : "approved-hash",
        });
        if (v === 0) {
          const offset = Number(hexToBigInt(s));
          if (offset < staticEnd) staticEnd = offset;
        }
      } else if (v > 30) {
        owners.push({
          owner: await recoverAddress({
            hash: hashMessage({ raw: safeMessageHash }),
            signature: `${r}${s.slice(2)}${(v - 4).toString(16)}`,
          }),
          kind: "eth_sign",
        });
      } else {
        owners.push({
          owner: await recoverAddress({
            hash: safeMessageHash,
            signature: slice(signature, i, i + 65),
          }),
          kind: "eoa",
        });
      }
    } catch {
      break;
    }
  }
  return owners;
}
