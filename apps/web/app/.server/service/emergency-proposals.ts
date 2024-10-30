import { db } from "@/.server/db";
import { createEmergencyProposalCall } from "@/.server/db/dto/emergency-proposal-calls";
import {
  createEmergencyProposal,
  getEmergencyProposalByExternalId,
  updateEmergencyProposal,
} from "@/.server/db/dto/emergency-proposals";
import type { Call } from "@/common/calls";
import type { FullEmergencyProp } from "@/common/emergency-proposal-schema";
import { emergencyProposalStatusSchema } from "@/common/emergency-proposal-status";
import { calculateUpgradeProposalHash } from "@/utils/emergency-proposals";
import { notFound } from "@/utils/http";
import { type Hex, hexToBigInt } from "viem";
import { l1Rpc } from "./ethereum-l1/client";
import { emergencyUpgradeBoardAddress } from "./ethereum-l1/contracts/protocol-upgrade-handler";
import { env } from "@config/env.server";

export async function broadcastSuccess(propsalId: Hex) {
  const proposal = await getEmergencyProposalByExternalId(propsalId);
  if (!proposal) {
    throw notFound();
  }

  proposal.status = emergencyProposalStatusSchema.enum.BROADCAST;
  await updateEmergencyProposal(proposal);
}

export type CallValidation = {
  call: Call;
  isValid: boolean;
};

export async function validateEmergencyProposalCalls(calls: Call[]): Promise<CallValidation[]> {
  return Promise.all(
    calls.map(async (call) => {
      return await validateCall(call);
    })
  );
}

export async function validateCall(call: Call): Promise<CallValidation> {
  try {
    await l1Rpc.call({
      to: call.target,
      data: call.data,
      value: hexToBigInt(call.value),
      account: env.UPGRADE_HANDLER_ADDRESS,
    });
    return { call, isValid: true };
  } catch {
    return { call, isValid: false };
  }
}

export const saveEmergencyProposal = async (data: FullEmergencyProp, calls: Call[]) => {
  const externalId = calculateUpgradeProposalHash(
    calls,
    data.salt,
    await emergencyUpgradeBoardAddress()
  );

  const currentDate = new Date();

  return await db.transaction(async (sqlTx) => {
    const proposal = await createEmergencyProposal(
      {
        status: "ACTIVE",
        proposer: data.proposer as Hex,
        proposedOn: currentDate,
        changedOn: currentDate,
        externalId,
        salt: data.salt as Hex,
        title: data.title,
      },
      { tx: sqlTx }
    );
    for (const call of calls) {
      await createEmergencyProposalCall(
        {
          data: call.data,
          proposalId: proposal.id,
          value: call.value,
          target: call.target,
        },
        { tx: sqlTx }
      );
    }
    return proposal;
  });
};
