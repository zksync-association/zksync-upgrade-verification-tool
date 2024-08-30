import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import { useNavigate } from "@remix-run/react";
import type React from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { type Hex, decodeAbiParameters, getAbiItem } from "viem";
import { useAccount, useWriteContract } from "wagmi";

type ExecuteUpgradeButtonProps = {
  target: Hex;
  proposalCalldata: Hex;
  children?: React.ReactNode;
  disabled: boolean;
};

export default function ExecuteUpgradeButton({
  children,
  target,
  proposalCalldata,
  disabled,
}: ExecuteUpgradeButtonProps) {
  const { address } = useAccount();
  const { writeContract, isPending } = useWriteContract();
  const navigate = useNavigate();

  const execContractWrite = async (e: React.MouseEvent) => {
    e.preventDefault();

    toast.loading("Broadcasting transaction...", { id: "broadcasting-tx" });

    const abiItem = getAbiItem({
      abi: ALL_ABIS.handler,
      name: "execute",
    });

    const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], proposalCalldata);

    writeContract(
      {
        account: address,
        address: target,
        functionName: "execute",
        abi: ALL_ABIS.handler,
        args: [upgradeProposal],
        dataSuffix: proposalCalldata,
      },
      {
        onSuccess: (hash) => {
          toast.success("Transaction broadcasted successfully", { id: "broadcasting-tx" });
          navigate(
            $path("/app/transactions/:hash", {
              hash,
            })
          );
        },
        onError: () => {
          console.error(e);
          toast.error("Error broadcasting transaction", { id: "broadcasting-tx" });
        },
      }
    );
  };

  return (
    <Button loading={isPending} onClick={execContractWrite} disabled={disabled || isPending}>
      {children}
    </Button>
  );
}
