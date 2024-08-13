import type { EmergencyProposalStatus } from "@/common/proposal-status";
import { type Hex, hexToBigInt, isAddressEqual } from "viem";

export type BasicSignature = { signer: Hex; signature: Hex };
export type BasicProposal = {
  salt: Hex;
  status: EmergencyProposalStatus;
  externalId: Hex;
};

export function filterSignatures<T extends BasicSignature>(members: Hex[], signatures: T[]): T[] {
  return signatures
    .filter((s) => members.some((member) => isAddressEqual(s.signer, member)))
    .sort((a, b) => Number(hexToBigInt(a.signer) - hexToBigInt(b.signer)));
}

export function classifySignatures<T extends BasicSignature>(
  guardianMembers: Hex[],
  councilMembers: Hex[],
  zkFoundation: Hex,
  allSignatures: T[]
): { guardians: T[]; council: T[]; foundation: T | null } {
  const [zkFoundationSig] = filterSignatures([zkFoundation], allSignatures);
  return {
    guardians: filterSignatures(guardianMembers, allSignatures),
    council: filterSignatures(councilMembers, allSignatures),
    foundation: zkFoundationSig ?? null,
  };
}
