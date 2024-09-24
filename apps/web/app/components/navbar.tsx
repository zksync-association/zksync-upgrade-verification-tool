import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { $path } from "remix-routes";
import { Button } from "./ui/button";
import ConnectButton from "./connect-button";
import { Link, useFetcher } from "@remix-run/react";
import useOptionalUser from "./hooks/use-optional-user";
import { ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY } from "./providers/role-revalidator-provider";

export default function Navbar() {
  const user = useOptionalUser();
  const fetcher = useFetcher({ key: ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY });

  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <div className="flex items-center space-x-2">
          <Link to={$path("/")}>
            <Logo />
          </Link>
          <EnvBadge />
        </div>
        <div className="flex items-center space-x-2">
          {user !== null && (
            <Button
              className="w-[200px] disabled:opacity-100"
              loading={user === null || fetcher.state !== "idle"}
              disabled
              data-testid="user-role"
            >
              {user.role === "guardian" && "Guardian"}
              {user.role === "securityCouncil" && "Security Council"}
              {user.role === "visitor" && "Visitor"}
              {user.role === "zkFoundation" && "ZkSync Foundation"}
              {user.role === "zkAdmin" && "ZkAdmin"}
            </Button>
          )}
          {user !== null && <ConnectButton />}
        </div>
      </nav>
    </header>
  );
}
