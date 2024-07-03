import zksync from "@/images/zksync.svg";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export default function Index() {
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
    </main>
  );
}
