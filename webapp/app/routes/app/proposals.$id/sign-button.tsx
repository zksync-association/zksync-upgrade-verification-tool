import { Button } from "@/components/ui/button";
import { useChains, useSignTypedData } from "wagmi";
import { Hex } from "viem";
import { useCallback } from "react";

type ContractData = {
  name: string,
  address: Hex,
  actionName: string
}

type SignButtonProps = {
  proposalId: Hex,
  contractData: ContractData,
  onSuccess: (signature: Hex) => void,
  onError: (error: Error) => void,
  children?: React.ReactNode,
}

export default function SignButton({children, proposalId, contractData, onSuccess, onError}: SignButtonProps) {
  const {data, signTypedData, error, isSuccess} = useSignTypedData()

  if (error) {
    onError(error)
  }

  if (isSuccess) {
    onSuccess(data)
  }

  const [chain] = useChains()

  const onClick = useCallback(
    () => {
      console.log("onClick")
      signTypedData({
        domain: {
          name: contractData.name,
          version: "1",
          chainId: chain.id,
          verifyingContract: contractData.address
        },
        primaryType: contractData.actionName,
        message: {
          id: proposalId
        },
        types: {
          [contractData.actionName]: [{
            name: "id",
            type: "bytes32"
          }]
        }
      })
    }, [
      contractData.name,
      contractData.actionName,
      contractData.address,
      proposalId
    ]
  )

  return <Button onClick={onClick}>{children}</Button>
}