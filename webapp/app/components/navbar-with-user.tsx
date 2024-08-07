import type { UserRole } from "@/.server/service/authorized-users";
import ConnectButton from "@/components/connect-button";
import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { $path } from "remix-routes";

export default function NavbarWithUser({ role }: { role: UserRole | null }) {
  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <div className="flex items-center space-x-2">
          <a href={$path("/")}>
            <Logo />
          </a>
          <EnvBadge />
        </div>
        <div className="flex items-center space-x-2">
          {role && (
            <Button className="disabled:opacity-100" disabled>
              {role === "guardian" && "Guardian"}
              {role === "securityCouncil" && "Security Council"}
              {role === "visitor" && "Visitor"}
            </Button>
          )}
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
