import ConnectButton from "@/components/connect-button";
import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { NodeEnv } from "@config/env.server";
import { $path } from "remix-routes";
import { UserRole } from "@/common/user-role";

export default function NavbarWithUser({
  role,
  environment,
}: { role: UserRole | null; environment: NodeEnv }) {
  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <div className="flex items-center space-x-2">
          <a href={$path("/")}>
            <Logo />
          </a>
          <EnvBadge environment={environment} />
        </div>
        <div className="flex items-center space-x-2">
          {role && (
            <Button className="disabled:opacity-100" disabled>
              {role === "guardian" && "Guardian"}
              {role === "securityCouncil" && "Security Council"}
              {role === "visitor" && "Visitor"}
              {role === "zkFoundation" && "ZkSync Foundation"}
            </Button>
          )}
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
