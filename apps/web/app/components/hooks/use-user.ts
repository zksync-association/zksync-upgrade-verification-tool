import { useAccount } from "wagmi";
import useUserRoleCookie from "./use-user-role-cookie";
import type { UserRole } from "@/common/user-role-schema";
import type { Address } from "viem";

function useUser({ required }: { required: false }): { address?: Address; role?: UserRole };
function useUser(): { address: Address; role: UserRole };
function useUser({
  required,
}: { required?: boolean } = {}):
  | { address: Address; role: UserRole }
  | { address?: Address; role?: UserRole } {
  const { cookie: role } = useUserRoleCookie();
  const { address } = useAccount();

  if (required && (!address || !role)) {
    throw new Error("User not logged in");
  }

  return {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    address: required ? address! : address,
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    role: required ? role!.role : role?.role,
  };
}

export default useUser;
