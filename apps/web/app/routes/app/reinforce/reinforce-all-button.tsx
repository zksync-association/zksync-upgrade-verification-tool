import { Button } from "@/components/ui/button";
import { protocolUpgradeHandlerReinforceAbi } from "@/utils/reinforce-abis";
import { useFetcher } from "@remix-run/react";
import { toast } from "react-hot-toast";
import type { Hex } from "viem";
import { useWriteContract } from "wagmi";

type Props = {
  handlerAddress: Hex;
  mode: "freeze" | "unfreeze";
  disabled?: boolean;
};

/**
 * Calls reinforceFreeze() or reinforceUnfreeze() on the ProtocolUpgradeHandler.
 * These functions call _freeze() / _unfreeze() internally which will freeze
 * ALL hyperchains + pause bridges once fully deployed (currently the inner
 * logic is behind a TODO; use ReinforceChainButton for per-chain control).
 */
export function ReinforceAllButton({ handlerAddress, mode, disabled }: Props) {
  const { writeContract, isPending } = useWriteContract();
  const fetcher = useFetcher();

  const functionName = mode === "freeze" ? "reinforceFreeze" : "reinforceUnfreeze";
  const label = mode === "freeze" ? "Reinforce Freeze (All Chains + Bridges)" : "Reinforce Unfreeze (All Chains + Bridges)";
  const toastId = `reinforce-all-${mode}`;

  const onClick = () => {
    toast.loading(`Broadcasting ${label}…`, { id: toastId });
    writeContract(
      {
        address: handlerAddress,
        abi: protocolUpgradeHandlerReinforceAbi,
        functionName,
        args: [],
      },
      {
        onSuccess: (hash) => {
          toast.success(`Transaction broadcast: ${hash.slice(0, 10)}…`, { id: toastId });
          fetcher.submit(null, { method: "GET" });
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
      variant={mode === "freeze" ? "destructive" : "secondary"}
      loading={isPending}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
