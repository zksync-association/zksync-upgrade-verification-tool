import { useAccount } from "wagmi";
import useUserRoleCookie from "./use-user-role-cookie";
import type { UserRole } from "@/common/user-role-schema";
import type { Address } from "viem";

export default function useOptionalUser(): { address: Address; role: UserRole } | null {
  const { cookie: role } = useUserRoleCookie();
  const { address } = useAccount();

  if (address === undefined || role === undefined) {
    return null;
  }

  return {
    address,
    role: role.role,
  };
}
