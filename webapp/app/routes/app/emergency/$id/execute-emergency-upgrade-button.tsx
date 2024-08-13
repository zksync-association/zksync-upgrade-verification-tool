import type { Call } from "@/common/calls";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { Button } from "@/components/ui/button";
import { ALL_ABIS } from "@/utils/raw-abis";
import { type BasicProposal, type BasicSignature, classifySignatures } from "@/utils/signatures";
import { useFetcher, useNavigate } from "@remix-run/react";
import type React from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import { type Hex, encodeAbiParameters, hexToBigInt } from "viem";
import { useWriteContract } from "wagmi";

export type ExecuteEmergencyUpgradeButtonProps = {
  children?: React.ReactNode;
  boardAddress: Hex;
  gatheredSignatures: BasicSignature[];
  allGuardians: Hex[];
  allCouncil: Hex[];
  zkFoundationAddress: Hex;
  proposal: BasicProposal;
  calls: Call[];
};

function encodeSignatures(signatures: BasicSignature[]): Hex {
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
  gatheredSignatures,
  allGuardians,
  allCouncil,
  zkFoundationAddress,
  proposal,
  calls,
}: ExecuteEmergencyUpgradeButtonProps) {
  const { writeContract, isPending } = useWriteContract();
  const { submit } = useFetcher();
  const navigate = useNavigate();

  const {
    guardians: guardianSignatures,
    council: councilSignatures,
    foundation: zkFoundationSignature,
  } = classifySignatures(allGuardians, allCouncil, zkFoundationAddress, gatheredSignatures);

  const enabled = proposal.status === emergencyProposalStatusSchema.enum.READY;

  const onClick = () => {
    if (!zkFoundationSignature) {
      throw new Error("zkFoundationSignature should be present");
    }

    toast.loading("Broadcasting transaction...", { id: "exec-emergency-upgrade" });
    writeContract(
      {
        abi: ALL_ABIS.emergencyBoard,
        functionName: "executeEmergencyUpgrade",
        args: [
          calls.map((c) => ({ ...c, value: hexToBigInt(c.value) })),
          proposal.salt,
          encodeSignatures(guardianSignatures),
          encodeSignatures(councilSignatures),
          zkFoundationSignature.signature,
        ],
        address: boardAddress,
      },
      {
        onSuccess: async (hash) => {
          submit(
            { intent: "broadcastSuccess", proposalId: proposal.externalId },
            { method: "POST" }
          );
          toast.success("Transaction broadcast success", { id: "exec-emergency-upgrade" });
          navigate($path("/app/transactions/:hash", { hash }));
        },
        onError: (e) => {
          console.error(e);
          toast.error("Error. Transaction was not broadcasted", { id: "exec-emergency-upgrade" });
        },
      }
    );
  };

  return (
    <Button disabled={!enabled} onClick={onClick} loading={isPending}>
      {children}
    </Button>
  );
}
