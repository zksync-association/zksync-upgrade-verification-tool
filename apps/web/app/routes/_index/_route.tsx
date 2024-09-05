import { getUserAuthRole } from "@/.server/service/authorized-users";
import { checkConnection } from "@/.server/service/clients";
import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import NavbarWithUser from "@/components/navbar-with-user";
import { Button } from "@/components/ui/button";
import { getUserFromHeader } from "@/utils/auth-headers";
import { parseFormData } from "@/utils/read-from-request";
import { env } from "@config/env.server";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { addressSchema } from "@repo/common/schemas";
import { getUserRoleCookie } from "@server/utils/user-role-cookie";
import { $path } from "remix-routes";
import { useAccount, useAccountEffect } from "wagmi";

export function loader({ request }: LoaderFunctionArgs) {
  const showButtons = env.ALLOW_PRIVATE_ACTIONS;
  try {
    return { user: getUserFromHeader(request), showButtons };
  } catch {
    return { user: null, showButtons };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const data = parseFormData(await request.formData(), { address: addressSchema });
  if (!data.success) {
    return json({ status: "error", message: "Failed to get form data" }, { status: 400 });
  }
  const address = data.data.address;

  // Check if connection is up and running
  const isUp = await checkConnection();
  if (!isUp) {
    throw redirect($path("/app/down"));
  }

  // Get user role and save it in a cookie
  const role = await getUserAuthRole(address);
  const cookie = getUserRoleCookie(role);
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}

export default function Index() {
  const account = useAccount();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const { user, showButtons } = useLoaderData<typeof loader>();

  useAccountEffect({
    // On connection, we want to set the user role in a cookie
    onConnect({ address }) {
      fetcher.submit({ address }, { method: "POST" });
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
                  {showButtons && (
                    <>
                      <Link to={$path("/app/emergency")}>
                        <Button variant="destructive">Emergency Upgrades</Button>
                      </Link>
                      <Link to={$path("/app/freeze")}>
                        <Button variant="secondary">Freeze Requests</Button>
                      </Link>
                      <Link to={$path("/app/l2-cancellations")}>
                        <Button variant="secondary">L2 Proposals Veto</Button>
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
