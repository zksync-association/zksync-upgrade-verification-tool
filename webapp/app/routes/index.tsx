import { getUserAuthRole } from "@/.server/service/authorized-users";
import { checkConnection } from "@/.server/service/clients";
import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import NavbarWithUser from "@/components/navbar-with-user";
import { Button } from "@/components/ui/button";
import { getUserFromHeader } from "@/utils/auth-headers";
import { clientEnv } from "@config/env.server";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useNavigate } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import { zodHex } from "validate-cli";
import { useAccount } from "wagmi";

export function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = getUserFromHeader(request);
    const environment = clientEnv.NODE_ENV;
    return { environment, user };
  } catch {
    console.log("No Connected User");
    return { environment: clientEnv.NODE_ENV, user: { address: null, role: null } };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // On error redirect to the home page, address should be set by the backend
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw redirect($path("/"));
  }
  const parsedAddress = zodHex.safeParse(address);
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
  const { environment, user } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  useEffect(() => {
    if (account.isConnected) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [account.isConnected, fetcher.submit]);

  const handleStandardUpgrades = () => {
    navigate($path("/app"));
  };

  const handleEmergencyUpgrades = () => {
    navigate($path("/app/emergency"));
  };
  return (
    <>
      {account.isConnected ? (
        <NavbarWithUser role={user.role} environment={environment} />
      ) : (
        <Navbar environment={environment} />
      )}
      <div className="relative mt-6 flex max-h-[700px] flex-1">
        <div className="cta-bg -z-10 pointer-events-none w-full" />
        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-1 flex-col items-center justify-center text-center md:max-w-3xl">
            <h1 className="font-bold text-3xl md:text-5xl">Upgrade Analysis & Voting Tool</h1>
            <p className="mt-10 text-lg md:max-w-xl">
              Analyze upgrade proposal transaction call data in human-readable format and cast your
              vote.
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
                  <Button onClick={handleStandardUpgrades}>Standard Upgrades</Button>
                  <Button onClick={handleEmergencyUpgrades} variant={"ghost"}>
                    Emergency Upgrades
                  </Button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
