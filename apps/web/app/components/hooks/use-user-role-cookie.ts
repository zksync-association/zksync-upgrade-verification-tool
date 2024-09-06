import {
  USER_ROLE_COOKIE_NAME,
  userRoleCookieOptions,
  type UserRoleCookie,
} from "@server/utils/user-role-cookie";
import { useCookies } from "react-cookie";

export default function useUserRoleCookie(): {
  cookie: UserRoleCookie | undefined;
  setCookie: (value: UserRoleCookie) => void;
} {
  const [cookie, setCookie] = useCookies<
    typeof USER_ROLE_COOKIE_NAME,
    { [USER_ROLE_COOKIE_NAME]?: UserRoleCookie }
  >([USER_ROLE_COOKIE_NAME]);

  return {
    cookie: cookie[USER_ROLE_COOKIE_NAME],
    setCookie: (value) => setCookie(USER_ROLE_COOKIE_NAME, value, userRoleCookieOptions),
  };
}
