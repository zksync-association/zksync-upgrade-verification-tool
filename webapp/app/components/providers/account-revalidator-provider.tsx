import { useRevalidator } from "@remix-run/react";
import { type ReactNode, useEffect } from "react";
import { useConfig } from "wagmi";
import { watchAccount } from "wagmi/actions";

export default function AccountRevalidatorProvider({ children }: { children: ReactNode }) {
  const revalidator = useRevalidator();
  const config = useConfig();

  useEffect(() => {
    return watchAccount(config, {
      onChange(account, prevAccount) {
        if (account.address !== prevAccount.address) {
          revalidator.revalidate();
        }
      },
    });
  }, [config, revalidator.revalidate]);

  return children;
}
