import { useAuth } from "@/components/context/auth-context";
import zksync from "@/images/zksync.svg";
import { getUserFromHeader } from "@/utils/auth-headers";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { useAccount } from "wagmi";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export async function action({ request }: ActionFunctionArgs) {
  const { address } = getUserFromHeader(request);
  if (!address) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const authorized = await new Promise((resolve, _) => setTimeout(() => resolve(true), 3000));

  return json({ authorized });
}

export default function Index() {
  const auth = useAuth();
  const fetcher = useFetcher<typeof action>();
  const { isConnected, address } = useAccount();

  useEffect(() => {
    if (auth.isAuthenticated && isConnected) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [isConnected, auth.isAuthenticated, fetcher.submit]);

  return (
    <main className="flex flex-col items-center">
      <img src={zksync} alt="zkSync" className="mx-auto h-48 w-48" />
      <h1 className="font-semibold text-4xl text-primary">
        zkSync Era Upgrade Analysis & Voting Tool
      </h1>
      <p className="mt-10 text-lg">
        Analyze upgrade proposal transaction call data in human-readable format and cast your vote.
      </p>

      <p className="text-muted-foreground">Please connect your wallet to continue.</p>

      <div className="mt-10">
        <ConnectButton showBalance={false} />
      </div>

      {auth.isAuthenticated && (
        <div className="mt-4">
          {fetcher.state === "submitting" && <div>Loading...</div>}
          {fetcher.state === "idle" && (
            <div>{fetcher.data?.authorized ? "User is authorized" : "User is not authorized"}</div>
          )}
        </div>
      )}
    </main>
  );
}
