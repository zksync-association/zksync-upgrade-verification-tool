import TxLink from "@/components/tx-link";
import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
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
  const { writeContractAsync, isPending, data } = useWriteContract();
  const [txid, setTxid] = useState<Hex | null>(null);

  useEffect(() => {
    if (data) {
      toast.success("Transaction broadcasted!", { id: "sign_button", duration: 5000 });
      setTxid(data);
    }
  }, [data]);

  const execContractWrite = async (e: React.MouseEvent) => {
    e.preventDefault();

    const abiItem = getAbiItem({
      abi: ALL_ABIS.handler,
      name: "execute",
    });

    const [upgradeProposal] = decodeAbiParameters([abiItem.inputs[0]], proposalCalldata);

    try {
      await writeContractAsync({
        account: address,
        address: target,
        functionName: "execute",
        abi: ALL_ABIS.handler,
        args: [upgradeProposal],
        dataSuffix: proposalCalldata,
      });
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        if (e.message.includes("User rejected the request.")) {
          toast("Transaction canceled", { icon: "✖️" });
        } else {
          toast.error(`Error broadcasting tx: ${e.message}`);
        }
      } else {
        toast.error(`Error broadcasting tx: ${e}`);
      }
    }
  };

  return (
    <>
      <Button loading={isPending} onClick={execContractWrite} disabled={disabled || isPending}>
        {children}
      </Button>
      {txid && <TxLink txid={txid} />}
    </>
  );
}
