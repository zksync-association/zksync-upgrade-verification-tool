import { z } from "zod";

export const signActionSchema = z.enum([
  "ExtendLegalVetoPeriod",
  "ApproveUpgradeGuardians",
  "ApproveUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeZKFoundation",
  "ApproveSoftFreeze",
  "ApproveHardFreeze",
  "ApproveUnfreeze",
  "ApproveSetSoftFreezeThreshold",
]);

export type SignAction = z.infer<typeof signActionSchema>;
