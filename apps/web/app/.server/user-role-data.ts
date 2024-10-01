import type { Hex } from "viem";
import { type UserRole, UserRoleEnum } from "@/common/user-role-schema";
import {
  guardiansAddress,
  securityCouncilAddress,
} from "./service/ethereum-l1/contracts/protocol-upgrade-handler";

const USER_ROLE_DATA = {
  [UserRoleEnum.enum.guardian]: {
    multisigContractForRole: guardiansAddress,
  },
  [UserRoleEnum.enum.securityCouncil]: {
    multisigContractForRole: securityCouncilAddress,
  },
  [UserRoleEnum.enum.zkFoundation]: {
    multisigContractForRole: () => {
      throw new Error("No target contract for zk foundation");
    },
  },
  [UserRoleEnum.enum.visitor]: {
    multisigContractForRole: () => {
      throw new Error("visitors cannot sign");
    },
    regularUpgradeContractNameByRole: () => {
      throw new Error("Visitors cannot sign regular upgrades");
    },
  },
  [UserRoleEnum.enum.zkAdmin]: {
    multisigContractForRole: () => {
      throw new Error("zkAdmin cannot sign");
    },
    regularUpgradeContractNameByRole: () => {
      throw new Error("zkAdmin cannot sign regular upgrades");
    },
  },
};

export async function multisigContractForRole(role: UserRole): Promise<Hex> {
  return USER_ROLE_DATA[role].multisigContractForRole();
}
