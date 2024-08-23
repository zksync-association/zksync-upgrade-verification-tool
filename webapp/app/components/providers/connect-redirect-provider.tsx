import { useLocation, useNavigate } from "@remix-run/react";
import type { ReactNode } from "react";
import { $path } from "remix-routes";
import { useAccountEffect } from "wagmi";

export default function ConnectRedirectProvider({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useAccountEffect({
    onDisconnect() {
      if (location.pathname !== "/") {
        navigate($path("/"));
      }
    },
  });

  return children;
}
