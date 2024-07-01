import { AspectRatio } from "@/components/ui/aspect-ratio";
import zksync from "@/images/zksync.svg";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { MetaFunction } from "@remix-run/node";
import { useAccount } from "wagmi";

export const meta: MetaFunction = () => {
  return [
    { title: "ZkSync Era upgrades" },
    { name: "description", content: "ZkSync Era upgrade voting tool" },
  ];
};

export default function Index() {
  const { address } = useAccount();

  return (
    <main className="flex flex-col items-center">
      <img src={zksync} alt="zkSync" className="mx-auto h-48 w-48" />
      <h1 className="font-semibold text-4xl text-primary">
        zkSync Era Upgrade Analysis & Voting Tool
      </h1>
      <p className="mt-10 text-lg">
        Analyze upgrade proposal transaction call data in human-readble format and cast your vote.
      </p>

      <AspectRatio
        ratio={3 / 2}
        className="mt-10 flex items-center justify-center rounded-md border-2 border-dashed bg-muted/20"
      >
        {address ? (
          <p>
            You have <span className="text-primary">3</span> available proposals.
          </p>
        ) : (
          <p className="text-muted-foreground">Please connect your wallet to continue.</p>
        )}
      </AspectRatio>

      <div className="absolute bottom-10 animate-slide-up">
        <ConnectButton showBalance={false} />
      </div>
    </main>
  );
}
