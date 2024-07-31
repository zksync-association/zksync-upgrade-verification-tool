import { createOrIgnoreEmergencyProposal } from "@/.server/db/dto/emergencyProposals";
import type { EmergencyProp } from "@/routes/app/emergency/create-emergency-proposal-modal";
import { type Hash, encodeAbiParameters, keccak256, parseEther } from "viem";

export const saveEmergencyProposal = async (data: EmergencyProp) => {
  const externalId = keccak256(
    encodeAbiParameters([{ type: "bytes", name: "upgradeProposal" }], [data.calls as Hash])
  );

  if (!data.proposer) {
    throw new Error("Proposer is required");
  }

  const value = parseEther(data.value);

  await createOrIgnoreEmergencyProposal({
    calls: data.calls as Hash,
    proposer: data.proposer,
    proposedOn: new Date(),
    externalId,
    title: data.title,
    targetAddress: data.targetAddress,
    value,
  });
};
