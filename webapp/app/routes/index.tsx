import ConnectButton from "@/components/connect-button";
import { useAuth } from "@/components/context/auth-context";
import { getUserFromHeader } from "@/utils/auth-headers";
import { type ActionFunctionArgs, json } from "@remix-run/node";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect } from "react";
import { $path } from "remix-routes";

export async function action({ request }: ActionFunctionArgs) {
  const { address } = getUserFromHeader(request);
  if (!address) {
    return json({ authorized: false });
  }
  const authorized: boolean = await new Promise((resolve, _) =>
    setTimeout(() => resolve(true), 3000)
  );
  if (!authorized) {
    return json({ authorized: false });
  }
  return json({ authorized: true });
}

export default function Index() {
  const auth = useAuth();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.isAuthenticated) {
      fetcher.submit({}, { method: "POST" });
    }
  }, [auth.isAuthenticated, fetcher.submit]);

  useEffect(() => {
    if (fetcher.state === "idle") {
      if (fetcher.data?.authorized) {
        navigate($path("/app"));
      }
    }
  }, [fetcher.state, fetcher.data?.authorized, navigate]);

  return (
    <div className="relative mt-6 flex max-h-[700px] flex-1">
      <div className="cta-bg -z-10 pointer-events-none w-full" />
      <main className="flex flex-1 flex-col items-center justify-center">
        <div className="flex flex-1 flex-col items-center justify-center text-center md:max-w-3xl">
          <h1 className="font-bold text-3xl md:text-5xl">Upgrade Analysis & Voting Tool</h1>
          <p className="mt-10 text-lg md:max-w-xl">
            Analyze upgrade proposal transaction call data in human-readable format and cast your
            vote.
          </p>
          <p className="mt-5 text-lg md:max-w-xl">Please connect your wallet to continue.</p>
          <div className="mt-10">
            <ConnectButton
              loading={fetcher.state === "submitting"}
              authorized={fetcher.data?.authorized ?? false}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
