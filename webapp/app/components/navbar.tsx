import Logo from "@/components/logo";
import { $path } from "remix-routes";

export default function Navbar() {
  return (
    <header className="w-full">
      <nav>
        <a href={$path("/")}>
          <Logo />
        </a>
      </nav>
    </header>
  );
}
