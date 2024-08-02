import { unauthorized } from "@/utils/http";
import { USER_ADDRESS_HEADER, USER_ROLE_HEADER } from "@server/middlewares/auth";
import { UserRole } from "@/common/user-role";

export function getUserFromHeader(request: Request) {
  const address = request.headers.get(USER_ADDRESS_HEADER);
  const role = request.headers.get(USER_ROLE_HEADER);
  const parsedRole = UserRole.optional().safeParse(role);
  return { address, role: parsedRole.data ?? null };
}

export function requireUserFromHeader(request: Request) {
  const { address, role } = getUserFromHeader(request);

  const parsedRole = UserRole.safeParse(role);
  if (!parsedRole.success) {
    throw unauthorized();
  }

  return { address, role: parsedRole.data };
}
