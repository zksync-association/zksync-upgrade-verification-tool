import { Button } from "@/components/ui/button";
import { protocolUpgradeHandlerReinforceAbi } from "@/utils/reinforce-abis";
import { useFetcher } from "@remix-run/react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
import { useWriteContract } from "wagmi";

type Props = {
  handlerAddress: Hex;
  chainId: bigint;
  mode: "freeze" | "unfreeze";
  onSuccess?: () => void;
};

export function ReinforceChainButton({ handlerAddress, chainId, mode, onSuccess }: Props) {
  const { writeContract, isPending } = useWriteContract();
  const fetcher = useFetcher();

  const functionName =
    mode === "freeze" ? "reinforceFreezeOneChain" : "reinforceUnfreezeOneChain";

  const label =
    mode === "freeze"
      ? `Reinforce Freeze Chain ${chainId}`
      : `Reinforce Unfreeze Chain ${chainId}`;

  const toastId = `reinforce-chain-${chainId}-${mode}`;

  const onClick = () => {
    toast.loading(`Broadcasting ${label}…`, { id: toastId });
    writeContract(
      {
        address: handlerAddress,
        abi: protocolUpgradeHandlerReinforceAbi,
        functionName,
        args: [chainId],
      },
      {
        onSuccess: (hash) => {
          toast.success(`Transaction broadcast: ${hash.slice(0, 10)}…`, { id: toastId });
          // Revalidate the page data so the reinforced chains list updates
          fetcher.submit(null, { method: "GET" });
          onSuccess?.();
        },
        onError: (err) => {
          console.error(err);
          toast.error(`Error: ${err.message.slice(0, 80)}`, { id: toastId });
        },
      }
    );
  };

  return (
    <Button
      size="sm"
      variant={mode === "freeze" ? "destructive" : "secondary"}
      loading={isPending}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
