import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Meta } from "@/utils/meta";
import { env } from "@config/env.server";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import { $path } from "remix-routes";
import { useAccount } from "wagmi";

export const meta = Meta["/"];

export function loader() {
  const showButtons = env.ALLOW_PRIVATE_ACTIONS;
  return { showButtons };
}

export default function Index() {
  const account = useAccount();
  const { showButtons } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <>
      <Navbar />
      <div className="relative mt-6 flex max-h-[700px] flex-1">
        <div className="cta-bg -z-10 pointer-events-none w-full" />
        <main className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-1 flex-col items-center justify-center text-center md:max-w-3xl">
            <h1 className="font-bold text-3xl md:text-5xl">Governance Authentication</h1>
            <p className="mt-10 text-lg md:max-w-xl">Authenticate ZKsync Governance</p>
            <div className="mt-10">
              {!account.isConnected ? (
                <ConnectButton />
              ) : (
                <div className="flex space-x-4">
                  <Link to={$path("/app/proposals")}>
                    <Button
                      loading={
                        navigation.state === "loading" &&
                        navigation.location.pathname === $path("/app/proposals")
                      }
                      className="w-[200px]"
                    >
                      Standard Upgrades
                    </Button>
                  </Link>
                  {showButtons && (
                    <>
                      <Link to={$path("/app/emergency")}>
                        <Button
                          loading={
                            navigation.state === "loading" &&
                            navigation.location.pathname === $path("/app/emergency")
                          }
                          className="w-[200px]"
                          variant="destructive"
                        >
                          Emergency Upgrades
                        </Button>
                      </Link>
                      <Link to={$path("/app/freeze")}>
                        <Button
                          loading={
                            navigation.state === "loading" &&
                            navigation.location.pathname === $path("/app/freeze")
                          }
                          className="w-[200px]"
                          variant="secondary"
                        >
                          Freeze Requests
                        </Button>
                      </Link>
                      <Link to={$path("/app/l2-cancellations")}>
                        <Button
                          loading={
                            navigation.state === "loading" &&
                            navigation.location.pathname === $path("/app/l2-cancellations")
                          }
                          className="w-[200px]"
                          variant="secondary"
                        >
                          Governor Veto
                        </Button>
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
