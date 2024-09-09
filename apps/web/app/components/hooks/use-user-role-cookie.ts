import {
  USER_ROLE_COOKIE_NAME,
  userRoleCookieOptions,
  UserRoleCookieSchema,
  type UserRoleCookie,
} from "@server/utils/user-role-cookie";
import { useCookies } from "react-cookie";

export default function useUserRoleCookie(): {
  cookie: UserRoleCookie | undefined;
  setCookie: (value: UserRoleCookie) => void;
  removeCookie: () => void;
} {
  const [cookie, setCookie, removeCookie] = useCookies<
    typeof USER_ROLE_COOKIE_NAME,
    { [USER_ROLE_COOKIE_NAME]?: UserRoleCookie }
  >([USER_ROLE_COOKIE_NAME]);

  let cookieValue = cookie[USER_ROLE_COOKIE_NAME];

  if (!UserRoleCookieSchema.safeParse(cookieValue).success) {
    cookieValue = undefined;
  }

  return {
    cookie: cookieValue,
    setCookie: (value) => setCookie(USER_ROLE_COOKIE_NAME, value, userRoleCookieOptions),
    removeCookie: () => removeCookie(USER_ROLE_COOKIE_NAME),
  };
}
