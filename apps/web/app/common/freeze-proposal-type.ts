import { z } from "zod";
import { dateToUnixTimestamp } from "@/utils/date";
import { type SignAction, signActionEnum } from "@/common/sign-action";

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
  },
];

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
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({
      nonce: fp.externalId,
      validUntil,
    }),
    freezeAction: signActionEnum.enum.SoftFreeze,
  },
  [FreezeProposalsTypeEnum.enum.HARD_FREEZE]: {
    signTypes: noThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({
      nonce: fp.externalId,
      validUntil,
    }),
    freezeAction: signActionEnum.enum.HardFreeze,
  },
  [FreezeProposalsTypeEnum.enum.UNFREEZE]: {
    signTypes: noThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({
      nonce: fp.externalId,
      validUntil,
    }),
    freezeAction: signActionEnum.enum.Unfreeze,
  },
  [FreezeProposalsTypeEnum.enum.SET_SOFT_FREEZE_THRESHOLD]: {
    signTypes: withThreshold,
    buildMessage: (fp: FreezeProposal, validUntil: number) => ({
      nonce: fp.externalId,
      validUntil,
      threshold: fp.softFreezeThreshold,
    }),
    freezeAction: signActionEnum.enum.SetSoftFreezeThreshold,
  },
};

export function ethTypesForFreezeKind(kind: FreezeProposalsType): EthType[] {
  return FREEZE_TYPE_DATA[kind].signTypes;
}

type FreezeProposal = {
  type: FreezeProposalsType;
  externalId: bigint;
  softFreezeThreshold: number | null;
  validUntil: Date;
};

export function buildSignatureMessage(proposal: FreezeProposal) {
  const timestamp = dateToUnixTimestamp(proposal.validUntil);
  return FREEZE_TYPE_DATA[proposal.type].buildMessage(proposal, timestamp);
}

export function freezeActionFromType(type: FreezeProposalsType): SignAction {
  return FREEZE_TYPE_DATA[type].freezeAction;
}
