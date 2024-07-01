import type { MetaFunction } from "@remix-run/node";
import zksync from "@/images/zksync.svg";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export default function Index() {
  return (
    <main className="flex flex-col items-center">
      <img src={zksync} alt="zkSync" className="w-64 h-64 mx-auto" />
      <h1 className="text-4xl text-primary font-semibold">
        zkSync Era Upgrade Analysis & Voting Tool
      </h1>
      <p className="mt-10 text-lg">
        Analyze upgrade proposal transaction call data in human-readble format and cast your vote.
      </p>
      <p className="mt-1 text-lg">Please connect your wallet to continue.</p>
      <div className="mt-10">
        <ConnectButton />
      </div>
    </main>
  );
}
