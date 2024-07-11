import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import type React from "react";
import { toast } from "react-hot-toast";
import { decodeAbiParameters, decodeFunctionData, getAbiItem, Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";

type BroadcastTxButtonProps2 = {
  target: Hex;
  proposalCalldata: Hex;
  children?: React.ReactNode;
};

export default function ContractWriteButton2({
  children,
  target,
  proposalCalldata
}: BroadcastTxButtonProps2) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const execContractWrite = async (e: React.MouseEvent) => {
    e.preventDefault();

    const abiItem = getAbiItem({
      abi: ALL_ABIS["handler"],
      name: "execute"
    })

    const [ upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]],
      proposalCalldata
    )

    try {
      await writeContractAsync({
        account: address,
        address: target,
        functionName: "execute",
        abi: ALL_ABIS["handler"],
        args: [upgradeProposal],
        dataSuffix: proposalCalldata
      });
      toast.success("Transaction executed!", { id: "sign_button" });
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        toast.error(`Error broadcasting tx: ${e.message}`);
      } else {
        toast.error(`Error broadcasting tx: ${e}`);
      }
    }
  }

  return (
    <Button onClick={execContractWrite}>
      {children}
    </Button>
  );
}
