import { createOrIgnoreEmergencyProposal } from "@/.server/db/dto/emergencyProposals";
import { type Hash, encodeAbiParameters, keccak256 } from "viem";

// todo: use zod
export const saveEmergencyProposal = async (data: {
  title: string;
  targetAddress: Hash;
  calls: Hash;
  value: string;
  proposer: Hash;
}) => {
  const externalId = keccak256(
    encodeAbiParameters([{ type: "bytes", name: "upgradeProposal" }], [data.calls])
  );

  await createOrIgnoreEmergencyProposal({
    calls: data.calls,
    proposer: data.proposer,
    proposedOn: new Date(),
    externalId,
    title: data.title,
    targetAddress: data.targetAddress,
    value: BigInt(data.value) || 0n,
  });
};
