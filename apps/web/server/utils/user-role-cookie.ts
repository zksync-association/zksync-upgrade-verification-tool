import { UserRoleSchema } from "@/common/user-role-schema";

const USER_ROLE_COOKIE_NAME = "user-role";

export function parseUserRoleCookie(cookieHeader: string) {
  const cookie = parseCookie(cookieHeader, USER_ROLE_COOKIE_NAME);
  const parsedRole = UserRoleSchema.safeParse(cookie);
  const role = parsedRole.success ? parsedRole.data : undefined;
  return role;
}

export function getUserRoleCookie(userRole: string) {
  return `${USER_ROLE_COOKIE_NAME}=${encodeURIComponent(userRole)};path=/;samesite=Lax`;
}

function parseCookie(cookie: string, key: string) {
  const keyValue = cookie.split("; ").find((x) => x.startsWith(`${key}=`));
  if (!keyValue) {
    return undefined;
  }

  return keyValue.substring(key.length + 1);
}
