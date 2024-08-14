import NavbarWithUser from "@/components/navbar-with-user";
import { getUserFromHeader } from "@/utils/auth-headers";
import { clientEnv } from "@config/env.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";

export function loader({ request }: LoaderFunctionArgs) {
  const user = getUserFromHeader(request);
  const environment = clientEnv.NODE_ENV;
  return { user, environment };
}

export default function App() {
  const { user, environment } = useLoaderData<typeof loader>();
  return (
    <>
      <NavbarWithUser role={user.role} environment={environment} />
      <div className="flex w-full flex-1 flex-col">
        <img
          className="-z-10 absolute top-0 left-0"
          src="/graphics/blur-overlay.svg"
          alt="Blur overlay"
        />
        <div className="w-full text-center">
          <h1 className="mt-20 font-bold text-3xl md:text-5xl">Upgrade Analysis & Approval Tool</h1>
        </div>
        <Outlet />
      </div>
    </>
  );
}
