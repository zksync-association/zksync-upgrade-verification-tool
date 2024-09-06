import { z } from "zod";
import { dateToUnixTimestamp } from "@/utils/date";

export const FreezeProposalsTypeEnum = z.enum([
  "SOFT_FREEZE",
  "HARD_FREEZE",
  "UNFREEZE",
  "SET_SOFT_FREEZE_THRESHOLD",
]);
export type FreezeProposalsType = z.infer<typeof FreezeProposalsTypeEnum>;

type EthType = {
  name: string;
  type: string;
};

const noThreshold: EthType[] = [
  {
    name: "nonce",
    type: "uint256",
  },
  {
    name: "validUntil",
    type: "uint256",
  }
]

const withThreshold: EthType[] = [
  {
    name: "threshold",
    type: "uint256",
  },
  ...noThreshold,
];

const FREEZE_TYPE_DATA: Record<FreezeProposalsType, any> = {
  [FreezeProposalsTypeEnum.enum.SOFT_FREEZE]: {
    signTypes: noThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({ nonce: fp.externalId, validUntil })
  },
  [FreezeProposalsTypeEnum.enum.HARD_FREEZE]: {
    signTypes: noThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({ nonce: fp.externalId, validUntil })
  },
  [FreezeProposalsTypeEnum.enum.UNFREEZE]: {
    signTypes: noThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({ nonce: fp.externalId, validUntil })
  },
  [FreezeProposalsTypeEnum.enum.SET_SOFT_FREEZE_THRESHOLD]: {
    signTypes: withThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({ nonce: fp.externalId, validUntil, threshold: fp.softFreezeThreshold })
  },
};

export function ethTypesForFreezeKind(kind: FreezeProposalsType): EthType[] {
  return FREEZE_TYPE_DATA[kind]
}

type FreezeProposal = {
  type: FreezeProposalsType;
  externalId: BigInt;
  softFreezeThreshold: number | null;
  validUntil: Date;
}

export function buildSignatureMessage(proposal: FreezeProposal) {
  const timestamp = dateToUnixTimestamp(proposal.validUntil)
  return FREEZE_TYPE_DATA[proposal.type].buildMessage(proposal, timestamp)
}