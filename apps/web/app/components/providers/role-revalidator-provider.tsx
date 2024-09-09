import type { action } from "@/routes/resources+/validate-account";
import { useEffect, type ReactNode } from "react";
import toast from "react-hot-toast";
import { $path } from "remix-routes";
import { useFetcherWithReset } from "../hooks/use-fetcher-with-reset";
import useUserRoleCookie from "../hooks/use-user-role-cookie";
import { useAccount } from "wagmi";
import { watchAccount } from "wagmi/actions";
import { useConfig } from "wagmi";

export const ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY = "role-revalidator-provider-fetcher";

export default function RoleRevalidatorProvider({ children }: { children: ReactNode }) {
  const { cookie, setCookie, removeCookie } = useUserRoleCookie();
  const { isConnected } = useAccount();
  const config = useConfig();

  // This hook is used to fetch the user role from the server, and reset the fetcher in order
  // to not show old data from previous fetches.
  // https://github.com/remix-run/remix/discussions/2749
  const fetcher = useFetcherWithReset<typeof action>({
    key: ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY,
  });

  // In this effect we are watching for account changes and updating the user role cookie accordingly.
  // - If the account is not connected, we remove the cookie.
  // - If the account is connected, but the cookie is not set, we leave it unset, as the next Effect
  //   will set it up properly.
  // - If the account is connected, and the cookie is set, we set the cookie revalidate to true.
  //   The next Effect will then pick it up and revalidate the user role.
  useEffect(() => {
    return watchAccount(config, {
      onChange(account, prevAccount) {
        if (account.address === undefined) {
          return removeCookie();
        }

        if (cookie === undefined) {
          return;
        }

        if (account.address !== prevAccount.address) {
          return setCookie({ role: cookie.role, revalidate: true });
        }
      },
    });
  }, [config, setCookie, removeCookie, cookie]);

  // In this effect we will trigger role revalidation.
  // - If the account is not connected, we do nothing.
  // - If the fetcher is not idle, we do nothing, as revalidation is already in progress.
  // - If the account is connected, and the cookie is not set or revalidate is true, we trigger the revalidation.
  useEffect(() => {
    if (!isConnected || fetcher.state !== "idle") {
      return;
    }

    if (cookie === undefined || cookie.revalidate) {
      toast.loading("Revalidating user role...", { id: "revalidate-user-role" });
      fetcher.reset();
      fetcher.submit(null, {
        method: "POST",
        action: $path("/resources/validate-account"),
      });
    }
  }, [cookie, fetcher.submit, fetcher.state, fetcher.reset, isConnected]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      fetcher.reset();
      toast.success("User role revalidated", { id: "revalidate-user-role" });
    }
  }, [fetcher.state, fetcher.data, fetcher.reset]);

  return children;
}
