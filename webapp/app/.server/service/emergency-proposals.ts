import {
  createOrIgnoreEmergencyProposal,
  getAllEmergencyProposals,
} from "@/.server/db/dto/emergencyProposals";
import type { EmergencyProp } from "@/routes/app/emergency/create-emergency-proposal-modal";
import { EMERGENCY_BOARD, calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { type Hash, parseEther } from "viem";

export const saveEmergencyProposal = async (data: EmergencyProp) => {
  const externalId = calculateUpgradeProposalHash(
    [{ data: data.calldata as Hash, target: data.targetAddress, value: parseEther(data.value) }],
    data.salt as Hash,
    EMERGENCY_BOARD
  );

  if (!data.proposer) {
    throw new Error("Proposer is required");
  }

  const value = parseEther(data.value);

  await createOrIgnoreEmergencyProposal({
    status: "ACTIVE",
    calldata: data.calldata as Hash,
    proposer: data.proposer,
    proposedOn: new Date(),
    externalId,
    salt: data.salt as Hash,
    title: data.title,
    targetAddress: data.targetAddress,
    value,
  });
};

export const getEmergencyProposals = async () => {
  const emergencyProposals = await getAllEmergencyProposals();
};
