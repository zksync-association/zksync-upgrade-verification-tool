import ConnectButton from "@/components/connect-button";
import Logo from "@/components/logo";
import { $path } from "remix-routes";

export default function NavbarWithUser() {
  return (
    <header className="w-full">
      <nav className="flex justify-between">
        <a href={$path("/")}>
          <Logo />
        </a>
        <ConnectButton />
      </nav>
    </header>
  );
}
