import { Button } from "@/components/ui/button";
import { useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, decodeAbiParameters, getAbiItem, type Hex, hexToBigInt, hexToNumber } from "viem";
import { upgradeHandlerAbi } from "@/utils/contract-abis";
import type { StartUpgradeData } from "@/common/types";

export type StartUpgradeButtonProps = {
  target: Address,
  data: StartUpgradeData | null
}

export function StartUpgradeButton(props : StartUpgradeButtonProps) {
  const { address } = useAccount();
  const {writeContract} = useWriteContract()

  const onClick = useCallback(() => {
    if (props.data === null) {
      throw new Error("data should not be null")
    }

    const abiItem = getAbiItem({
      abi: upgradeHandlerAbi,
      name: "startUpgrade"
    });

    const {
      proposal: rawProposal,
      l2BatchNumber,
      l2MessageIndex,
      l2TxNumberInBatch,
      proof
    } = props.data

    const [proposal] = decodeAbiParameters([abiItem.inputs[4]], rawProposal);

    writeContract({
      account: address,
      address: props.target,
      functionName: "startUpgrade",
      abi: upgradeHandlerAbi,
      args: [
        hexToBigInt(l2BatchNumber),
        hexToBigInt(l2MessageIndex),
        hexToNumber(l2TxNumberInBatch),
        proof,
        proposal
      ]
    }, {
      onError: (e) => {
        console.error(e)
      }
    })
  }, [writeContract, props.data])

  return <Button onClick={onClick} disabled={props.data === null}>Start</Button>
}