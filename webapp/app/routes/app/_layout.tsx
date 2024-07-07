import NavbarWithUser from "@/components/navbar-with-user";
import { Outlet } from "@remix-run/react";

export default function App() {
  return (
    <>
      <NavbarWithUser />
      <div className="w-full">
        <img
          className="-z-10 absolute top-0 left-0"
          src="/graphics/blur-overlay.svg"
          alt="Blur overlay"
        />
        <div className="w-full text-center">
          <h1 className="mt-20 font-bold text-3xl md:text-5xl">Upgrade Analysis & Voting Tool</h1>
        </div>
        <Outlet />
      </div>
    </>
  );
}
