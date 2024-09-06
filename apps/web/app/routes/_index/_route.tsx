import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { env } from "@config/env.server";
import { Link, useLoaderData } from "@remix-run/react";
import { $path } from "remix-routes";
import { useAccount } from "wagmi";

export function loader() {
  const showButtons = env.ALLOW_PRIVATE_ACTIONS;
  return { showButtons };
}

export default function Index() {
  const account = useAccount();
  const { showButtons } = useLoaderData<typeof loader>();

  return (
    <>
      {<Navbar />}
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
                <ConnectButton />
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
