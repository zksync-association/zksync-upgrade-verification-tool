import { UserRole } from "@/.server/service/authorized-users";
import { unauthorized } from "@/utils/http";
import { USER_ADDRESS_HEADER, USER_ROLE_HEADER } from "@server/middlewares/auth";

export function getUserFromHeader(request: Request) {
  const address = request.headers.get(USER_ADDRESS_HEADER);
  const role = request.headers.get(USER_ROLE_HEADER);
  return { address, role };
}

export function requireUserFromHeader(request: Request) {
  const { address, role } = getUserFromHeader(request);
  if (!address) {
    throw unauthorized();
  }

  const parsedRole = UserRole.safeParse(role);
  if (!parsedRole.success) {
    throw unauthorized();
  }

  return { address, role: parsedRole.data };
}
