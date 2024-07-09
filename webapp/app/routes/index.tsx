import { isUserAuthorized } from "@/.server/service/authorized-users";
import ConnectButton from "@/components/connect-button";
import { useAuth } from "@/components/context/auth-context";
import Navbar from "@/components/navbar";
import { getUserFromHeader } from "@/utils/auth-headers";
import { type ActionFunctionArgs, redirect } from "@remix-run/node";
import { useFetcher, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import { zodHex } from "validate-cli/src";

export async function action({ request }: ActionFunctionArgs) {
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw redirect($path("/"));
  }
  const authorized = await isUserAuthorized(zodHex.parse(address));
  if (!authorized) {
    throw redirect($path("/app/denied"));
  }
  throw redirect($path("/app"));
}

export default function Index() {
  const auth = useAuth();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();

  useEffect(() => {
    if (auth.isAuthenticated) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [auth.isAuthenticated, fetcher.submit]);

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
              <ConnectButton
                loading={
                  fetcher.state === "submitting" ||
                  (navigation.state === "loading" && navigation.location.pathname === $path("/app"))
                }
              />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
