import { createProposal, updateProposal } from "@/.server/db/dto/proposals";
import { isProposalActive } from "@/utils/proposal-states";
import { getProposals as getStoredProposals } from "@/.server/db/dto/proposals";
import { bigIntMax } from "@/utils/bigint";
import { l1Rpc } from "./ethereum-l1/client";
import {
  getUpgradeStartedEvents,
  getUpgradeState,
  getUpgradeStatus,
} from "./ethereum-l1/contracts/protocol-upgrade-handler";

export async function getProposals() {
  // First, we will update the status of all stored active proposals
  const storedProposals = await getStoredProposals();
  const activeStoredProposals = storedProposals.filter((p) => p.status === "ACTIVE");
  for (const proposal of activeStoredProposals) {
    const status = await getUpgradeState(proposal.externalId);
    const parsedStatus = isProposalActive(status) ? "ACTIVE" : "INACTIVE";
    if (proposal.status !== parsedStatus) {
      await updateProposal({
        id: proposal.id,
        status: parsedStatus,
      });
    }
  }

  // Then, we will fetch the logs and save new proposals
  const latestBlock = await l1Rpc.getBlock({ blockTag: "latest" });
  const currentBlock = latestBlock.number;

  // Logs are calculated from the last 40 * 24 * 360 blocks,
  // as this is a conservative estimation of oldest block with a valid upgrade.
  const from = bigIntMax(currentBlock - BigInt(40 * 24 * 360), BigInt(0));
  const logs = await getUpgradeStartedEvents({
    fromBlock: from,
    toBlock: "latest",
  });

  for (const log of logs) {
    const [_signature, id] = log.topics;
    // TODO: verify in which cases can the log args be undefined
    if (!log.args._proposal) {
      throw new Error("Invalid log");
    }

    // If proposal is already stored, we skip it
    if (storedProposals.some((p) => p.externalId === id)) {
      continue;
    }

    const [status, proposalData] = await Promise.all([getUpgradeState(id), getUpgradeStatus(id)]);

    await createProposal({
      externalId: id,
      calldata: log.data,
      proposedOn: new Date(proposalData.creationTimestamp * 1000),
      executor: log.args._proposal.executor,
      transactionHash: log.transactionHash,
      status: isProposalActive(status) ? "ACTIVE" : "INACTIVE",
    });
  }

  return getStoredProposals();
}

export async function nowInSeconds() {
  const block = await l1Rpc.getBlock({ blockTag: "latest" });
  return block.timestamp;
}
