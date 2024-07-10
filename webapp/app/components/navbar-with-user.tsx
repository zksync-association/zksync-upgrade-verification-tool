import type { UserRole } from "@/.server/service/authorized-users";
import ConnectButton from "@/components/connect-button";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { $path } from "remix-routes";

export default function NavbarWithUser({ role }: { role: UserRole | null }) {
  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <a href={$path("/")}>
          <Logo />
        </a>
        <div className="flex space-x-2">
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
