import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import type React from "react";
import { toast } from "react-hot-toast";
import { type Hex, encodeAbiParameters, hexToBigInt, isAddressEqual } from "viem";
import { useWriteContract } from "wagmi";

type Signature = { signer: Hex; signature: Hex };
type Proposal = {
  calldata: Hex;
  targetAddress: Hex;
  salt: Hex;
  value: string;
};

export type ExecuteEmergencyUpgradeButtonProps = {
  children?: React.ReactNode;
  boardAddress: Hex;
  signatures: Signature[];
  allGuardians: Hex[];
  allCouncil: Hex[];
  zkFoundationAddress: Hex;
  proposal: Proposal;
};

function encodeSignatures(signatures: Signature[]): Hex {
  return encodeAbiParameters(
    [
      { name: "addresses", type: "address[]" },
      { name: "signatures", type: "bytes[]" },
    ],
    [signatures.map((sig) => sig.signer), signatures.map((sig) => sig.signature)]
  );
}

export function ExecuteEmergencyUpgradeButton({
  children,
  boardAddress,
  signatures,
  allGuardians,
  allCouncil,
  zkFoundationAddress,
  proposal,
}: ExecuteEmergencyUpgradeButtonProps) {
  const { writeContract } = useWriteContract();

  const guardianSignatures = signatures
    .filter((s) => allGuardians.some((member) => isAddressEqual(s.signer, member)))
    .sort((a, b) => Number(hexToBigInt(a.signer) - hexToBigInt(b.signer)));

  const councilSignatures = signatures
    .filter((s) => allCouncil.some((member) => isAddressEqual(s.signer, member)))
    .sort((a, b) => Number(hexToBigInt(a.signer) - hexToBigInt(b.signer)));

  const zkFoundationSignature = signatures.find((s) =>
    isAddressEqual(s.signer, zkFoundationAddress)
  );

  const enabled =
    guardianSignatures.length >= 5 &&
    councilSignatures.length >= 9 &&
    zkFoundationSignature !== undefined;

  const abi = ALL_ABIS.emergencyBoard;

  const onClick = () => {
    if (!zkFoundationSignature) {
      throw new Error("zkFoundationSignature should be present");
    }

    toast.loading("Broadcasting transaction...", { id: "exec-emergency-upgrade" });

    writeContract(
      {
        abi,
        functionName: "executeEmergencyUpgrade",
        args: [
          [
            {
              target: proposal.targetAddress,
              value: BigInt(proposal.value),
              data: proposal.calldata,
            },
          ],
          proposal.salt,
          encodeSignatures(guardianSignatures),
          encodeSignatures(councilSignatures),
          zkFoundationSignature.signature,
        ],
        address: boardAddress,
      },
      {
        onSuccess: () => {
          toast.success("Transaction broadcasted successfully", { id: "exec-emergency-upgrade" });
        },
        onError: () => {
          toast.error("Error. Transaction was not broadcasted", { id: "exec-emergency-upgrade" });
        },
      }
    );
  };

  return (
    <Button disabled={!enabled} onClick={onClick}>
      {children}
    </Button>
  );
}
