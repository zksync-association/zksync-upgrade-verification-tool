import { unauthorized } from "@/utils/http";
import { readAuthSession } from "@server/utils/auth-session";
import { readUserRoleCookie } from "@server/utils/user-role-cookie";

export function requireUserFromRequest(request: Request) {
  const cookies = request.headers.get("Cookie") ?? "";

  const { address } = readAuthSession(cookies);
  const role = readUserRoleCookie(cookies);

  if (!address || !role) {
    throw unauthorized();
  }

  return { address, role: role.role };
}

export function getUserFromRequest(request: Request) {
  const cookies = request.headers.get("Cookie") ?? "";

  const { address } = readAuthSession(cookies);
  const role = readUserRoleCookie(cookies);

  return { address, role: role?.role };
}
