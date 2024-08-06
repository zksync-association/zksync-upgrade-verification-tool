import {
  createOrIgnoreEmergencyProposal,
  getEmergencyProposalByExternalId,
  updateEmergencyProposal,
} from "@/.server/db/dto/emergencyProposals";
import { emergencyBoardAddress } from "@/.server/service/authorized-users";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { notFound } from "@/utils/http";
import { type Hex, parseEther } from "viem";
import { FullEmergencyProp } from "@/common/emergency-proposal-schema";

export async function broadcastSuccess(propsalId: Hex) {
  const proposal = await getEmergencyProposalByExternalId(propsalId);
  if (!proposal) {
    throw notFound();
  }

  proposal.status = emergencyProposalStatusSchema.enum.BROADCAST;
  await updateEmergencyProposal(proposal);
}

export const saveEmergencyProposal = async (data: FullEmergencyProp) => {
  const externalId = calculateUpgradeProposalHash(
    [
      {
        data: data.calldata as Hex,
        target: data.targetAddress as Hex,
        value: parseEther(data.value),
      },
    ],
    data.salt as Hex,
    await emergencyBoardAddress()
  );

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
