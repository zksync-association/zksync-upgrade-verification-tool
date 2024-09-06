import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { $path } from "remix-routes";
import { Button } from "./ui/button";
import ConnectButton from "./connect-button";
import { useAccount } from "wagmi";
import { Link, useFetcher } from "@remix-run/react";
import useUser from "./hooks/use-user";
import { ROLE_REVALIDATOR_PROVIDER_FETCHER_KEY } from "./providers/role-revalidator-provider";

export default function Navbar() {
  const account = useAccount();
  const { role } = useUser({ required: false });
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
          {account.isConnected && (
            <Button
              className="w-[200px] disabled:opacity-100"
              loading={role === undefined || fetcher.state !== "idle"}
              disabled
              data-testid="user-role"
            >
              {role === "guardian" && "Guardian"}
              {role === "securityCouncil" && "Security Council"}
              {role === "visitor" && "Visitor"}
              {role === "zkFoundation" && "ZkSync Foundation"}
            </Button>
          )}
          {account.isConnected && <ConnectButton />}
        </div>
      </nav>
    </header>
  );
}
