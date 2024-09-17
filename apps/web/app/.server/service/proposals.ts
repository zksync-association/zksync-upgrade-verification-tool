import { createProposal, updateProposal } from "@/.server/db/dto/proposals";
import { upgradeHandlerAbi } from "@/.server/service/contract-abis";
import { isProposalActive, ProposalStateSchema } from "@/utils/proposal-states";
import { PROTOCOL_UPGRADE_HANDLER_RAW_ABI } from "@/utils/raw-abis";
import { env } from "@config/env.server";
import { getProposals as getStoredProposals } from "@/.server/db/dto/proposals";

import { l1Rpc } from "@/.server/service/clients";
import { type Hex, decodeEventLog, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

export async function getProposals() {
  // First, we will update the status of all stored active proposals
  const storedProposals = await getStoredProposals();
  const activeStoredProposals = storedProposals.filter((p) => p.status === "ACTIVE");
  for (const proposal of activeStoredProposals) {
    const status = await getProposalState(proposal.externalId);
    const parsedStatus = isProposalActive(status) ? "ACTIVE" : "INACTIVE";
    if (proposal.status !== parsedStatus) {
      await updateProposal({
        id: proposal.id,
        status: parsedStatus,
      });
    }
  }

  // Then, we will fetch the logs and save new proposals
  const latestBlock = await l1Rpc.getLatestBlock();
  const currentBlock = latestBlock.number;

  // Logs are calculated from the last 40 * 24 * 360 blocks,
  // as this is a conservative estimation of oldest block with a valid upgrade.
  const from = hexToBigInt(currentBlock) - BigInt(40 * 24 * 360);
  const logs = await l1Rpc.getLogs(upgradeHandlerAddress, numberToHex(from), "latest", [
    upgradeHandlerAbi.eventIdFor("UpgradeStarted"),
  ]);

  for (const log of logs) {
    const [signature, id] = log.topics;
    if (signature === undefined || id === undefined) {
      throw new Error("Invalid log");
    }

    // If proposal is already stored, we skip it
    if (storedProposals.some((p) => p.externalId === id)) {
      continue;
    }

    const status = await getProposalState(id);
    const proposal = decodeEventLog({
      abi: PROTOCOL_UPGRADE_HANDLER_RAW_ABI,
      eventName: "UpgradeStarted",
      data: log.data,
      topics: [signature, id],
    });
    const proposalData = await getProposalData(id);

    await createProposal({
      externalId: id,
      calldata: log.data,
      proposedOn: new Date(proposalData.creationTimestamp * 1000),
      executor: proposal.args._proposal.executor,
      transactionHash: log.transactionHash,
      status: isProposalActive(status) ? "ACTIVE" : "INACTIVE",
    });
  }

  return getStoredProposals();
}

export async function nowInSeconds() {
  const block = await l1Rpc.getLatestBlock();
  return block.timestamp;
}

export async function getProposalData(id: Hex) {
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

export async function getProposalState(id: Hex) {
  return await l1Rpc.contractRead(
    upgradeHandlerAddress,
    "upgradeState",
    upgradeHandlerAbi.raw,
    ProposalStateSchema,
    [id]
  );
}
