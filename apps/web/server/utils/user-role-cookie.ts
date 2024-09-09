import { UserRoleSchema } from "@/common/user-role-schema";
import { z } from "zod";

export const USER_ROLE_COOKIE_NAME = "user-role";

export const UserRoleCookieSchema = z.object({
  role: UserRoleSchema,
  revalidate: z.boolean(),
});

export type UserRoleCookie = z.infer<typeof UserRoleCookieSchema>;

export function readUserRoleCookie(cookieHeader: string): UserRoleCookie | undefined {
  const cookie = parseJsonCookie(cookieHeader, USER_ROLE_COOKIE_NAME);
  if (!cookie) {
    return undefined;
  }

  const parsedRole = UserRoleCookieSchema.safeParse(cookie);
  if (!parsedRole.success) {
    return undefined;
  }

  return parsedRole.data;
}

export function createUserRoleCookie(userRole: UserRoleCookie) {
  const options = Object.entries(userRoleCookieOptions).reduce((acc, [key, value]) => {
    return `${acc};${key}=${value}`;
  }, "");

  return `${USER_ROLE_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(userRole))}${options}`;
}

export const userRoleCookieOptions = {
  path: "/",
  sameSite: "lax",
} as const;

function parseCookie(cookie: string, key: string) {
  const keyValue = cookie.split("; ").find((x) => x.startsWith(`${key}=`));
  if (!keyValue) {
    return undefined;
  }

  return decodeURIComponent(keyValue.substring(key.length + 1));
}

function parseJsonCookie(cookie: string, key: string) {
  const parsedCookie = parseCookie(cookie, key);
  if (!parsedCookie) {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(parsedCookie);
  } catch {
    return undefined;
  }

  return json;
}
