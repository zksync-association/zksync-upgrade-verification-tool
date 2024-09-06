import type { action } from "@/routes/resources+/validate-account";
import { USER_ROLE_COOKIE_NAME, type UserRoleCookie } from "@server/utils/user-role-cookie";
import { useEffect, type ReactNode } from "react";
import { useCookies } from "react-cookie";
import toast from "react-hot-toast";
import { $path } from "remix-routes";
import { useFetcherWithReset } from "../hooks/use-fetcher-with-reset";

export const ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY = "role-revalidator-provider-fetcher";

export default function RoleRevalidatorProvider({ children }: { children: ReactNode }) {
  const fetcher = useFetcherWithReset<typeof action>({
    key: ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY,
  });
  const [cookies] = useCookies<
    typeof USER_ROLE_COOKIE_NAME,
    { [USER_ROLE_COOKIE_NAME]?: UserRoleCookie }
  >([USER_ROLE_COOKIE_NAME]);

  const userRoleCookie = cookies[USER_ROLE_COOKIE_NAME];

  useEffect(() => {
    if ((userRoleCookie === undefined || userRoleCookie.revalidate) && fetcher.state === "idle") {
      toast.loading("Revalidating user role...", { id: "revalidate-user-role" });
      fetcher.reset();
      fetcher.submit(null, {
        method: "POST",
        action: $path("/resources/validate-account"),
      });
    }
  }, [userRoleCookie, fetcher.submit, fetcher.state, fetcher.reset]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      fetcher.reset();
      toast.success("User role revalidated", { id: "revalidate-user-role" });
    }
  }, [fetcher.state, fetcher.data, fetcher.reset]);

  return children;
}
