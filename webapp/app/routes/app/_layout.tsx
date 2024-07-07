import { Outlet } from "@remix-run/react";

export default function App() {
  return (
    <div className="w-full">
      <img
        className="-z-10 absolute top-0 left-0"
        src="/graphics/blur-overlay.svg"
        alt="Blur overlay"
      />
      <Outlet />
    </div>
  );
}
