import { checkConnection } from "@/.server/service/clients";
import ConnectButton from "@/components/connect-button";
import Navbar from "@/components/navbar";
import { getUserFromHeader } from "@/utils/auth-headers";
import { clientEnv } from "@config/env.server";
import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";
import { zodHex } from "validate-cli";
import { useAccount } from "wagmi";

export function loader({ request }: LoaderFunctionArgs) {
  const environment = clientEnv.NODE_ENV;
  return { environment };
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
  throw redirect($path("/app"));
}

export default function Index() {
  const account = useAccount();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const { environment } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (account.isConnected) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [account.isConnected, fetcher.submit]);

  return (
    <>
      <Navbar environment={environment} />
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
