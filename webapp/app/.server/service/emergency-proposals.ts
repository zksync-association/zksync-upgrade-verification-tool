import {
  createOrIgnoreEmergencyProposal,
  getEmergencyProposalByExternalId,
  updateEmergencyProposal,
} from "@/.server/db/dto/emergencyProposals";
import { emergencyBoardAddress } from "@/.server/service/authorized-users";
import { l1Rpc } from "@/.server/service/clients";
import type { BasicEmergencyProp, FullEmergencyProp } from "@/common/emergency-proposal-schema";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { notFound } from "@/utils/http";
import { env } from "@config/env.server";
import { type Hex, parseEther } from "viem";

export async function broadcastSuccess(propsalId: Hex) {
  const proposal = await getEmergencyProposalByExternalId(propsalId);
  if (!proposal) {
    throw notFound();
  }

  proposal.status = emergencyProposalStatusSchema.enum.BROADCAST;
  await updateEmergencyProposal(proposal);
}

export async function validateEmergencyProposal(data: BasicEmergencyProp): Promise<string | null> {
  try {
    await l1Rpc.contractReadRaw(data.targetAddress, data.calldata, env.UPGRADE_HANDLER_ADDRESS);
    return null;
  } catch (e) {
    return "eth_call execution failed";
  }
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
