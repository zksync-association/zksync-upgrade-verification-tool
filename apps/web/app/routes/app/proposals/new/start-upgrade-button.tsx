import { Button } from "@/components/ui/button";
import { useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, decodeAbiParameters, getAbiItem, hexToBigInt, hexToNumber } from "viem";
import { upgradeHandlerAbi } from "@/utils/contract-abis";
import type { StartUpgradeData } from "@/common/types";
import { useFetcher } from "@remix-run/react";
import { toast } from "react-hot-toast";

export type StartUpgradeButtonProps = {
  target: Address;
  data: StartUpgradeData | null;
};

export function StartUpgradeButton(props: StartUpgradeButtonProps) {
  const { address } = useAccount();
  const { writeContract, status } = useWriteContract();
  const fetcher = useFetcher();

  const loading = status === "pending";

  const onClick = useCallback(() => {
    if (props.data === null) {
      throw new Error("data should not be null");
    }

    toast.loading("Broadcasting transaction...", { id: "start-regular-upgrade" });

    const abiItem = getAbiItem({
      abi: upgradeHandlerAbi,
      name: "startUpgrade",
    });

    const {
      proposal: rawProposal,
      l2BatchNumber,
      l2MessageIndex,
      l2TxNumberInBatch,
      proof,
    } = props.data;

    const [proposal] = decodeAbiParameters([abiItem.inputs[4]], rawProposal);

    writeContract(
      {
        account: address,
        address: props.target,
        functionName: "startUpgrade",
        abi: upgradeHandlerAbi,
        args: [
          hexToBigInt(l2BatchNumber),
          hexToBigInt(l2MessageIndex),
          l2TxNumberInBatch ? hexToNumber(l2TxNumberInBatch) : 0,
          proof,
          proposal,
        ],
      },
      {
        onSuccess: (txHash) => {
          toast.success("Transaction broadcasted successfully", { id: "start-regular-upgrade" });
          fetcher.submit({ txHash }, { method: "POST" });
        },
        onError: (e) => {
          toast.error("There was an error broadcasting the transaction.", {
            id: "start-regular-upgrade",
          });
          console.error(e);
        },
      }
    );
  }, [writeContract, props.data, props.target, address, fetcher.submit]);

  return (
    <Button className="w-48" onClick={onClick} disabled={props.data === null} loading={loading}>
      Initiate Approval
    </Button>
  );
}
