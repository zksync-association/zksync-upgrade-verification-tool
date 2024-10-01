import { useAccount } from "wagmi";
import useUserRoleCookie from "./use-user-role-cookie";
import type { UserRole } from "@/common/user-role-schema";
import type { Address } from "viem";

export default function useUser(): { address: Address; role: UserRole } {
  const { cookie: role } = useUserRoleCookie();
  const { address } = useAccount();

  if (!address || !role) {
    throw new Error("User not logged in");
  }

  return {
    address,
    role: role.role,
  };
}
