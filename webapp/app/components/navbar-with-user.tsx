import type { UserRole } from "@/.server/service/authorized-users";
import ConnectButton from "@/components/connect-button";
import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { NodeEnv } from "@config/env.server";
import { $path } from "remix-routes";

export default function NavbarWithUser({
  role,
  environment,
}: { role: UserRole | null; environment: NodeEnv }) {
  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <a href={$path("/")}>
          <Logo />
        </a>
        <div className="flex items-center space-x-2">
          <EnvBadge environment={environment} />
          {role && (
            <Button className="disabled:opacity-100" disabled>
              {role === "guardian" ? "Guardian" : "Security Council"}
            </Button>
          )}
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
