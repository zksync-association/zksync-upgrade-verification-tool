import { createOrIgnoreEmergencyProposal } from "@/.server/db/dto/emergencyProposals";
import type { EmergencyProp } from "@/routes/app/emergency/create-emergency-proposal-modal";
import { EMERGENCY_BOARD, calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { type Hex, parseEther } from "viem";

export const saveEmergencyProposal = async (data: EmergencyProp) => {
  const externalId = calculateUpgradeProposalHash(
    [
      {
        data: data.calldata as Hex,
        target: data.targetAddress as Hex,
        value: parseEther(data.value),
      },
    ],
    data.salt as Hex,
    EMERGENCY_BOARD
  );

  if (!data.proposer) {
    throw new Error("Proposer is required");
  }

  const value = Number(parseEther(data.value));
  const currentDate = new Date();

  await createOrIgnoreEmergencyProposal({
    status: "ACTIVE",
    calldata: data.calldata as Hex,
    proposer: data.proposer as Hex,
    proposedOn: currentDate,
    changedOn: currentDate,
    externalId,
    salt: data.salt as Hex,
    title: data.title,
    targetAddress: data.targetAddress as Hex,
    value,
  });
};
