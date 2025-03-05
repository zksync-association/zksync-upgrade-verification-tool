import Navbar from "@/components/navbar";
import { Outlet, useLocation } from "@remix-run/react";
import { $path } from "remix-routes";

export default function App() {
  const location = useLocation();

  return (
    <>
      <Navbar />
      <div className="flex w-full flex-1 flex-col">
        <img
          className="-z-10 absolute top-0 left-0"
          src="/graphics/blur-overlay.svg"
          alt="Blur overlay"
        />
        <div className="w-full text-center">
          <h1 className="pt-20 pb-14 font-bold text-3xl md:text-5xl">
            {getTitle(location.pathname)}
          </h1>
        </div>
        <Outlet />
      </div>
    </>
  );
}

function getTitle(path: string) {
  if (path.startsWith($path("/app/emergency"))) {
    return "Emergency Upgrades";
  }
  if (path.startsWith($path("/app/freeze"))) {
    return "Freeze Requests";
  }
  if (path.startsWith($path("/app/l2-cancellations"))) {
    return "Guardian Veto";
  }
  if (path.startsWith($path("/app/proposals"))) {
    return "Protocol Upgrade Proposals";
  }
}
