import { z } from "zod";

export const signActionSchema = z.enum([
  "ExtendLegalVetoPeriod",
  "ApproveUpgradeGuardians",
  "ApproveUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeZKFoundation",
  "SoftFreeze",
  "HardFreeze",
  "Unfreeze",
  "SetSoftFreezeThreshold",
  "CancelL2GovernorProposal",
]);

export type SignAction = z.infer<typeof signActionSchema>;
