import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import type { NodeEnv } from "@config/env.server";
import { $path } from "remix-routes";

export default function Navbar({ environment }: { environment: NodeEnv }) {
  return (
    <header className="w-full">
      <nav>
        <div className="flex items-center space-x-2">
          <a href={$path("/")}>
            <Logo />
          </a>
          <EnvBadge environment={environment} />
        </div>
      </nav>
    </header>
  );
}
