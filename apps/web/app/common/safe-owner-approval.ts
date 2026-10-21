import { safeAbi, safeSignMessageLibAbi } from "./abis";
import { safeMessageHashes } from "./safe";
import {
  type Address,
  type Hex,
  concat,
  encodeFunctionData,
  getAddress,
  keccak256,
  pad,
  toBytes,
  zeroAddress,
  zeroHash,
} from "viem";
import { sepolia } from "viem/chains";

// Safe's v1.3.0 deployment registry (canonical/eip155 share this runtime hash):
// https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.3.0/sign_message_lib.json
export const SAFE_OWNER_APPROVAL = {
  chainId: sepolia.id,
  handler: "0xD7B653c373aa9585141223d244DA857b10c92d85" as Address,
  library: "0xA65387F16B013cf2Af4605Ad8aA5ec25a2cbA3a2" as Address,
  libraryCodeHash: "0x3ac65dea3cc9dd0d7b7b800f834e3d73415b4e944bb94555c3e4a08fb137e918" as Hex,
  delegateCall: 1,
  ownerSignatureType: "0x01" as Hex,
  fallbackSlot: keccak256(toBytes("fallback_manager.handler.address")),
} as const;

export type SafeOwnerApprovalPlan = {
  chainId: number;
  safe: Address;
  owner: Address;
  digest: Hex;
  safeMessageHash: Hex;
  to: Address;
  data: Hex;
  value: "0";
  alreadyApproved: boolean;
  checkedAtBlock: string;
};

/** Only a transaction sent by this owner can use Safe's v=1 owner signature. */
export function safeOwnerMessageCall(safe: Address, owner: Address, digest: Hex) {
  const hashes = safeMessageHashes(SAFE_OWNER_APPROVAL.chainId, safe, digest);
  const signatures = concat([
    pad(getAddress(owner), { size: 32 }),
    zeroHash,
    SAFE_OWNER_APPROVAL.ownerSignatureType,
  ]);
  return {
    to: getAddress(safe),
    safeMessageHash: hashes.safeMessageHash,
    data: encodeFunctionData({
      abi: safeAbi,
      functionName: "execTransaction",
      args: [
        SAFE_OWNER_APPROVAL.library,
        0n,
        encodeFunctionData({
          abi: safeSignMessageLibAbi,
          functionName: "signMessage",
          args: [digest],
        }),
        SAFE_OWNER_APPROVAL.delegateCall,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        signatures,
      ],
    }),
  };
}
