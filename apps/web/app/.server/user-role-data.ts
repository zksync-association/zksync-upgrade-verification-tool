import { councilAddress, guardiansAddress } from "@/.server/service/authorized-users";
import type { Hex } from "viem";
import { type UserRole, UserRoleEnum } from "@/common/user-role-schema";

const USER_ROLE_DATA = {
  [UserRoleEnum.enum.guardian]: {
    multisigContractForRole: guardiansAddress,
  },
  [UserRoleEnum.enum.securityCouncil]: {
    multisigContractForRole: councilAddress,
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
};

export async function multisigContractForRole(role: UserRole): Promise<Hex> {
  return USER_ROLE_DATA[role].multisigContractForRole();
}
