import { checkConnection } from "@/.server/service/clients";
import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { getUserFromHeader } from "@/utils/auth-headers";
import { type ActionFunctionArgs, json, redirect } from "@remix-run/node";
import { Link, useFetcher, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import { zodHex } from "validate-cli";
import { useAccount } from "wagmi";

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

  return json({ status: "success" });
}

export default function Index() {
  const account = useAccount();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();

  useEffect(() => {
    if (account.isConnected) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [account.isConnected, fetcher.submit]);

  return (
    <>
      <Navbar />
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
                  <Link to={$path("/app")}>
                    <Button>Standard Upgrades</Button>
                  </Link>
                  <Link to={$path("/app/emergency")}>
                    <Button variant="secondary">Emergency Upgrades</Button>
                  </Link>
                  <Link to={$path("/app/freeze")}>
                    <Button variant="secondary">Freeze Proposals</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
