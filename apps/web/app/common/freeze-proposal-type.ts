import { z } from "zod";

export const FreezeProposalsTypeEnum = z.enum([
  "SOFT_FREEZE",
  "HARD_FREEZE",
  "UNFREEZE",
  "SET_SOFT_FREEZE_THRESHOLD",
]);
export type FreezeProposalsType = z.infer<typeof FreezeProposalsTypeEnum>;

const FREEZE_TYPE_DATA: Record<FreezeProposalsType, any> = {
  [FreezeProposalsTypeEnum.enum.SOFT_FREEZE]: {

  },
  [FreezeProposalsTypeEnum.enum.HARD_FREEZE]: {

  },
  [FreezeProposalsTypeEnum.enum.UNFREEZE]: {

  },
  [FreezeProposalsTypeEnum.enum.SET_SOFT_FREEZE_THRESHOLD]: {

  },
}