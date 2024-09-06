import { z } from "zod";
import { type SignAction, signActionEnum } from "@/common/sign-action";

export const UserRoleEnum = z.enum(["guardian", "securityCouncil", "zkFoundation", "visitor"]);
export type UserRole = z.infer<typeof UserRoleEnum>;

const USER_ROLE_DATA = {
  [UserRoleEnum.enum.guardian]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeGuardians,
    standardUpgradeActionForRole: signActionEnum.enum.ApproveUpgradeGuardians,
  },
  [UserRoleEnum.enum.securityCouncil]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeSecurityCouncil,
    standardUpgradeActionForRole: signActionEnum.enum.ApproveUpgradeSecurityCouncil,
  },
  [UserRoleEnum.enum.zkFoundation]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeZKFoundation,
    standardUpgradeActionForRole: null,
  },
  [UserRoleEnum.enum.visitor]: {
    emergencyUpgradeAction: null,
    standardUpgradeActionForRole: null,
  }
}

export function emergencyUpgradeActionForRole(role: UserRole): SignAction {
  const action = USER_ROLE_DATA[role].emergencyUpgradeAction
  if (action === null) {
    throw new Error(`${role} are not allowed to sign emergency upgrades`);
  }

  return action;
}

export function standardUpgradeActionForRole(role: UserRole): SignAction {
  const action = USER_ROLE_DATA[role].standardUpgradeActionForRole
  if (action === null) {
    throw new Error(`${role} are not allowed to sign regular upgrades`);
  }

  return action;
}
