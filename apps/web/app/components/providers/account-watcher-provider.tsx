import { type ReactNode, useEffect } from "react";
import { useConfig } from "wagmi";
import { watchAccount } from "wagmi/actions";
import useUserRoleCookie from "../hooks/use-user-role-cookie";

export default function AccountWatcherProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { cookie, setCookie } = useUserRoleCookie();

  useEffect(() => {
    return watchAccount(config, {
      onChange(account, prevAccount) {
        if (account.address !== prevAccount.address && account.address !== undefined) {
          setCookie({ role: cookie?.role ?? "visitor", revalidate: true });
        }
      },
    });
  }, [config, cookie?.role, setCookie]);

  return children;
}
