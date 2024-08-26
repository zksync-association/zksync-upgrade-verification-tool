import { addressSchema } from "@/common/basic-schemas";
import { type UserRole, UserRoleSchema } from "@/common/user-role-schema";
import { unauthorized } from "@/utils/http";
import { USER_ADDRESS_HEADER, USER_ROLE_HEADER } from "@server/middlewares/auth";
import type { Hex } from "viem";

export function getUserFromHeader(request: Request) {
  // Address should never fail as it's set by Express middleware
  const address = request.headers.get(USER_ADDRESS_HEADER);
  const parsedAddress = addressSchema.parse(address);

  const role = request.headers.get(USER_ROLE_HEADER);
  const parsedRole = UserRoleSchema.optional().safeParse(role);

  return { address: parsedAddress, role: parsedRole.data ?? null };
}

export function requireUserFromHeader(request: Request): { address: Hex; role: UserRole } {
  const { address, role } = getUserFromHeader(request);

  const parsedRole = UserRoleSchema.safeParse(role);
  if (!parsedRole.success) {
    throw unauthorized();
  }

  return { address, role: parsedRole.data };
}
