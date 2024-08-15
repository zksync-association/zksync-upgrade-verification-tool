import { useRevalidator } from "@remix-run/react";
import { type ReactNode, useEffect, useState } from "react";
import { useAccount } from "wagmi";

export default function AccountRevalidatorProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [previousAddress, setPreviousAddress] = useState(account.address);
  const revalidator = useRevalidator();

  useEffect(() => {
    if (account.address !== previousAddress) {
      setPreviousAddress(account.address);
      revalidator.revalidate();
    }
  }, [account.address, previousAddress, revalidator]);

  return children;
}
