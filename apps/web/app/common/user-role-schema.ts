import { z } from "zod";
import { type SignAction, signActionEnum } from "@/common/sign-action";

export const UserRoleEnum = z.enum([
  "guardian",
  "securityCouncil",
  "zkFoundation",
  "visitor",
  "zkAdmin",
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

const USER_ROLE_DATA = {
  [UserRoleEnum.enum.guardian]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeGuardians,
    standardUpgradeActionForRole: signActionEnum.enum.ApproveUpgradeGuardians,
    regularUpgradeContractNameByRole: "Guardians",
  },
  [UserRoleEnum.enum.securityCouncil]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeSecurityCouncil,
    standardUpgradeActionForRole: signActionEnum.enum.ApproveUpgradeSecurityCouncil,
    regularUpgradeContractNameByRole: "SecurityCouncil",
  },
  [UserRoleEnum.enum.zkFoundation]: {
    emergencyUpgradeAction: signActionEnum.enum.ExecuteEmergencyUpgradeZKFoundation,
    standardUpgradeActionForRole: null,
    regularUpgradeContractNameByRole: null,
  },
  [UserRoleEnum.enum.visitor]: {
    emergencyUpgradeAction: null,
    standardUpgradeActionForRole: null,
    regularUpgradeContractNameByRole: null,
  },
  [UserRoleEnum.enum.zkAdmin]: {
    emergencyUpgradeAction: null,
    standardUpgradeActionForRole: null,
    regularUpgradeContractNameByRole: null,
  },
};

export function emergencyUpgradeActionForRole(role: UserRole): SignAction {
  const action = USER_ROLE_DATA[role].emergencyUpgradeAction;
  if (action === null) {
    throw new Error(`${role} are not allowed to sign emergency upgrades`);
  }

  return action;
}

export function standardUpgradeActionForRole(role: UserRole): SignAction {
  const action = USER_ROLE_DATA[role].standardUpgradeActionForRole;
  if (action === null) {
    throw new Error(`${role} are not allowed to sign regular upgrades`);
  }

  return action;
}

export function regularUpgradeContractNameByRole(role: UserRole): string {
  const name = USER_ROLE_DATA[role].regularUpgradeContractNameByRole;
  if (name === null) {
    throw new Error(`${role} are not allowed to sign regular upgrades`);
  }

  return name;
}

export function chooseByRole<T>(
  role: UserRole,
  guardianOption: T,
  councilOption: T,
  defaultOption: T
): T {
  switch (role) {
    case "guardian":
      return guardianOption;
    case "securityCouncil":
      return councilOption;
    default:
      return defaultOption;
  }
}
