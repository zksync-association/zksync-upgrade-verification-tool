import { createOrIgnoreProposal } from "@/.server/db/dto/proposals";
import { upgradeHandlerAbi } from "@/.server/service/contract-abis";
import { PROPOSAL_STATES, StatusTime } from "@/utils/proposal-states";
import { PROTOCOL_UPGRADE_HANDLER_RAW_ABI } from "@/utils/raw-abis";
import { env } from "@config/env.server";

import { l1Rpc } from "@/.server/service/clients";
import { decodeEventLog, type Hex, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));

export type Proposal = {
  id: Hex;
  state: PROPOSAL_STATES;
};

export async function getProposals(): Promise<Proposal[]> {
  const latestBlock = await l1Rpc.getLatestBlock();
  const currentBlock = latestBlock.number;
  const currentHeight = hexToBigInt(currentBlock);
  const maxUpgradeLiftimeInBlocks = BigInt(40 * 24 * 360); // conservative estimation of oldest block with a valid upgrade

  const from = bigIntMax(currentHeight - maxUpgradeLiftimeInBlocks, 1n);
  const abi = upgradeHandlerAbi;

  //FIXME: remove
  if (env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 5)); // Avoid anvil crushing for mysterious reasons
  }
  const logs = await l1Rpc.getLogs(upgradeHandlerAddress, numberToHex(from), "latest", [
    abi.eventIdFor("UpgradeStarted"),
  ]);

  const proposals: Proposal[] = [];

  for (const log of logs) {
    const [signature, id] = log.topics;
    if (!signature || !id) {
      throw new Error("Invalid log");
    }
    const stateNumber = await getProposalStatus(id);

    const proposal = decodeEventLog({
      abi: PROTOCOL_UPGRADE_HANDLER_RAW_ABI,
      eventName: "UpgradeStarted",
      data: log.data,
      topics: [signature, id],
    });

    const data = await getProposalData(id);

    proposals.push({ id, state: stateNumber });
    await createOrIgnoreProposal({
      externalId: id,
      calldata: log.data,
      proposedOn: new Date(data.creationTimestamp * 1000),
      executor: proposal.args._proposal.executor,
      transactionHash: log.transactionHash,
    });
  }

  return proposals;
}

export type ProposalData = {
  creationTimestamp: number;
  securityCouncilApprovalTimestamp: number;
  guardiansApproval: boolean;
  guardiansExtendedLegalVeto: boolean;
  executed: boolean;
};

export function daysInSeconds(days: number): number {
  return days * 24 * 3600;
}

export async function nowInSeconds() {
  const block = await l1Rpc.getLatestBlock();
  return block.timestamp;
}

export function calculateStatusPendingDays(
  status: PROPOSAL_STATES,
  creationTimestamp: number,
  guardiansExtendedLegalVeto: boolean,
  nowInSeconds: number,
): StatusTime | null {
  if (status === PROPOSAL_STATES.LegalVetoPeriod) {
    const delta = nowInSeconds - creationTimestamp;
    const currentDay = Math.ceil(delta / daysInSeconds(1));
    const totalDays = guardiansExtendedLegalVeto ? 7 : 3;

    return {
      totalDays: totalDays,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.Waiting) {

    const days3 = daysInSeconds(3);
    const days7 = daysInSeconds(7);
    const vetoPeriodDuration = guardiansExtendedLegalVeto ? days7 : days3
    const delta = nowInSeconds - (creationTimestamp + vetoPeriodDuration)
    const currentDay = Math.ceil(delta / daysInSeconds(1));
    return {
      totalDays: 30,
      currentDay: currentDay,
    };
  }

  if (status === PROPOSAL_STATES.ExecutionPending) {
    return { totalDays: 1, currentDay: 1 };
  }

  return null;
}

export async function getProposalData(id: Hex): Promise<ProposalData> {
  const [
    creationTimestamp,
    securityCouncilApprovalTimestamp,
    guardiansApproval,
    guardiansExtendedLegalVeto,
    executed,
  ] = await l1Rpc.contractRead(
    upgradeHandlerAddress,
    "upgradeStatus",
    upgradeHandlerAbi.raw,
    z.tuple([z.number(), z.number(), z.boolean(), z.boolean(), z.boolean()]),
    [id]
  );

  return {
    creationTimestamp,
    executed,
    guardiansApproval,
    guardiansExtendedLegalVeto,
    securityCouncilApprovalTimestamp,
  };
}

export async function getProposalStatus(id: Hex) {
  return await l1Rpc.contractRead(
    upgradeHandlerAddress,
    "upgradeState",
    upgradeHandlerAbi.raw,
    z.number(),
    [id]
  );
}
