import { useLocation, useNavigate } from "@remix-run/react";
import { type ReactNode, useEffect } from "react";
import { $path } from "remix-routes";
import { useAccount } from "wagmi";

export default function ConnectRedirectProvider({ children }: { children?: ReactNode }) {
  const account = useAccount();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (account.isDisconnected && location.pathname !== "/") {
      navigate($path("/"));
    }
  }, [account.isDisconnected, navigate, location.pathname]);

  return children;
}
