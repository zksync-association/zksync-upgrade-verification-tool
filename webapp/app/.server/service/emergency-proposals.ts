import {
  createOrIgnoreEmergencyProposal,
  getEmergencyProposalByExternalId,
  updateEmergencyProposal,
} from "@/.server/db/dto/emergencyProposals";
import { emergencyBoardAddress } from "@/.server/service/authorized-users";
import { l1Rpc } from "@/.server/service/clients";
import type { Call } from "@/common/calls";
import type { FullEmergencyProp } from "@/common/emergency-proposal-schema";
import { emergencyProposalStatusSchema } from "@/common/proposal-status";
import { calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { notFound } from "@/utils/http";
import { env } from "@config/env.server";
import { type Hex, numberToHex } from "viem";

export async function broadcastSuccess(propsalId: Hex) {
  const proposal = await getEmergencyProposalByExternalId(propsalId);
  if (!proposal) {
    throw notFound();
  }

  proposal.status = emergencyProposalStatusSchema.enum.BROADCAST;
  await updateEmergencyProposal(proposal);
}

export async function validateEmergencyProposalCalls(calls: Call[]): Promise<string[]> {
  return await Promise.all(
    calls.map(async (call) => {
      return await validateCall(call);
    })
  ).then((list) => list.filter((msg) => msg !== null) as string[]);
}

export async function validateCall(call: Call): Promise<null | string> {
  try {
    await l1Rpc.contractReadRaw(call.target, call.data, env.UPGRADE_HANDLER_ADDRESS, call.value);
    return null;
  } catch (e) {
    return "eth_call execution failed";
  }
}

export const saveEmergencyProposal = async (data: FullEmergencyProp) => {
  const externalId = calculateUpgradeProposalHash(
    data.calls,
    data.salt as Hex,
    await emergencyBoardAddress()
  );

  const currentDate = new Date();

  const callsToStore = data.calls.map((call) => ({
    ...call,
    value: numberToHex(call.value),
  }));

  await createOrIgnoreEmergencyProposal({
    status: "ACTIVE",
    calls: callsToStore,
    proposer: data.proposer as Hex,
    proposedOn: currentDate,
    changedOn: currentDate,
    externalId,
    salt: data.salt as Hex,
    title: data.title,
  });
};
