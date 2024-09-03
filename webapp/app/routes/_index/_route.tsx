import { getUserAuthRole } from "@/.server/service/authorized-users";
import { checkConnection } from "@/.server/service/clients";
import { hexSchema } from "@/common/basic-schemas";
import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import NavbarWithUser from "@/components/navbar-with-user";
import { Button } from "@/components/ui/button";
import { getUserFromHeader } from "@/utils/auth-headers";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { $path } from "remix-routes";
import { useAccount, useAccountEffect } from "wagmi";
import { env } from "@config/env.server";

export function loader({ request }: LoaderFunctionArgs) {
  const showButtons = env.RENDER_EMERGENCY_BUTTONS;
  console.log("showButtons", showButtons, process.env.RENDER_EMERGENCY_BUTTONS);
  try {
    return { user: getUserFromHeader(request), showButtons };
  } catch {
    return { user: null, showButtons };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // On error redirect to the home page, address should be set by the backend
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw redirect($path("/"));
  }
  const parsedAddress = hexSchema.safeParse(address);
  if (!parsedAddress.success) {
    throw redirect($path("/"));
  }
  const isUp = await checkConnection();
  if (!isUp) {
    throw redirect($path("/app/down"));
  }
  const role = await getUserAuthRole(parsedAddress.data);

  return json({ status: "success", role });
}

export default function Index() {
  const account = useAccount();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const { user, showButtons } = useLoaderData<typeof loader>();

  useAccountEffect({
    onConnect() {
      fetcher.submit({}, { method: "POST" });
    },
  });

  return (
    <>
      {account.isConnected && user ? <NavbarWithUser role={user.role} /> : <Navbar />}
      <div className="relative mt-6 flex max-h-[700px] flex-1">
        <div className="cta-bg -z-10 pointer-events-none w-full" />
        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-1 flex-col items-center justify-center text-center md:max-w-3xl">
            <h1 className="font-bold text-3xl md:text-5xl">Upgrade Analysis & Approval Tool</h1>
            <p className="mt-10 text-lg md:max-w-xl">
              Analyze proposals, coordinate signature gathering, and execute protocol upgrades.
            </p>
            <div className="mt-10">
              {!account.isConnected ? (
                <ConnectButton
                  loading={
                    fetcher.state === "submitting" ||
                    (navigation.state === "loading" &&
                      navigation.location.pathname === $path("/app"))
                  }
                />
              ) : (
                <div className="flex space-x-4">
                  <Link to={$path("/app/proposals")}>
                    <Button>Standard Upgrades</Button>
                  </Link>
                  { showButtons && <>
                    <Link to={$path("/app/emergency")}>
                      <Button variant="destructive">Emergency Upgrades</Button>
                    </Link>
                    <Link to={$path("/app/freeze")}>
                      <Button variant="secondary">Freeze Requests</Button>
                    </Link>
                    <Link to={$path("/app/l2-cancellations")}>
                      <Button variant="secondary">L2 Proposals Veto</Button>
                    </Link>
                  </> }
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
