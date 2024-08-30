import EnvBadge from "@/components/env-badge";
import Logo from "@/components/logo";
import { $path } from "remix-routes";

export default function Navbar() {
  return (
    <header className="w-full">
      <nav>
        <div className="flex items-center space-x-2">
          <a href={$path("/")}>
            <Logo />
          </a>
          <EnvBadge />
        </div>
      </nav>
    </header>
  );
}
