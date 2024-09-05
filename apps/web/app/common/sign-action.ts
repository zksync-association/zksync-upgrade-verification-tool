import { z } from "zod";
import { type UserRole, UserRoleEnum } from "@/common/user-role-schema";

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

const EMERGENCY_UPGRADE_ACTION_NAMES = {
  guardian: signActionSchema.enum.ExecuteEmergencyUpgradeGuardians,
  securityCouncil: signActionSchema.enum.ExecuteEmergencyUpgradeSecurityCouncil,
  zkFoundation: signActionSchema.enum.ExecuteEmergencyUpgradeZKFoundation,
};

const REGULAR_UPGRADE_ACTION_NAMES: Partial<Record<UserRole, SignAction>> = {
  securityCouncil: signActionSchema.enum.ApproveUpgradeSecurityCouncil,
  guardian: signActionSchema.enum.ApproveUpgradeGuardians
}

export function emergencyUpgradeActionForRole(role: UserRole): SignAction {
  if (role === UserRoleEnum.enum.visitor) {
    throw new Error("Visitors are not allowed to sign emergency upgrades");
  }

  return EMERGENCY_UPGRADE_ACTION_NAMES[role];
}

export function standardUpgradeActionForRole(role: UserRole): SignAction {
  const action = REGULAR_UPGRADE_ACTION_NAMES[role];
  if (!action) {
    throw new Error(`${role} are not allowed to sign standard upgrades`)
  }
  return action
}
