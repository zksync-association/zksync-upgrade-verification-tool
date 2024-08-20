import { ZK_GOV_OPS_GOVERNOR_ABI } from "@/utils/raw-abis";
import { env } from "@config/env.server";
import { type Address, decodeEventLog, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";
import { db } from "../db";
import { createL2GovernorProposalCall } from "../db/dto/l2-governor-proposal-calls";
import { createOrIgnoreL2GovernorProposal } from "../db/dto/l2-governor-proposals";
import { l1Rpc, l2Rpc } from "./clients";
import { zkGovOpsGovernorAbi } from "./contract-abis";
import { bigIntMax } from "@/utils/bigint";

export async function getZkGovOpsProposals() {
  const latestBlock = await l1Rpc.getLatestBlock();
  const currentBlock = hexToBigInt(latestBlock.number);

  // Proposal lifetime is:
  // - 7 days vote delay period
  // - 7 days voting period
  // - 7 days optional extended voting period
  // Another 7 days is added in the calculation to have a conservative
  // estimation of the oldest block with a valid proposal.
  // Max proposal time is calculated in blocks, 1 second per block in L2,
  // therefore 3600 blocks per hour.
  const maxProposalLifetimeInBlocks = BigInt((21 + 7) * 24 * 3600); // conservative estimation of oldest block with a valid proposal

  const from = bigIntMax(currentBlock - maxProposalLifetimeInBlocks, 1n);
  const logs = await l1Rpc.getLogs(env.ZK_GOV_OPS_GOVERNOR_ADDRESS, numberToHex(from), "latest", [
    zkGovOpsGovernorAbi.eventIdFor("ProposalCreated"),
  ]);

  const proposals: {
    id: bigint;
    state: number;
  }[] = [];

  for (const log of logs) {
    const proposal = decodeEventLog({
      abi: ZK_GOV_OPS_GOVERNOR_ABI,
      eventName: "ProposalCreated",
      data: log.data,
      topics: log.topics as any,
    });
    const state = await getProposalState({
      proposalId: proposal.args.proposalId,
      targetAddress: env.ZK_GOV_OPS_GOVERNOR_ADDRESS,
    });

    proposals.push({ id: proposal.args.proposalId, state });

    await db.transaction(async (tx) => {
      const l2GovernorProposal = await createOrIgnoreL2GovernorProposal(
        {
          externalId: numberToHex(proposal.args.proposalId),
          proposer: proposal.args.proposer,
          description: proposal.args.description,
          type: "ZK_GOV_OPS_GOVERNOR",
        },
        { tx }
      );
      if (l2GovernorProposal === undefined) {
        return;
      }

      for (const [i, data] of proposal.args.calldatas.entries()) {
        const target = proposal.args.targets[i];
        const value = proposal.args.values[i];
        if (target === undefined || value === undefined) {
          throw new Error("Invalid proposal");
        }
        await createL2GovernorProposalCall(
          {
            data,
            proposalId: l2GovernorProposal.id,
            target,
            value: numberToHex(value),
          },
          { tx }
        );
      }
    });
  }

  return proposals;
}

async function getProposalState({
  proposalId,
  targetAddress,
}: { proposalId: bigint; targetAddress: Address }) {
  const state = await l2Rpc.contractRead(
    targetAddress,
    "state",
    ZK_GOV_OPS_GOVERNOR_ABI,
    z.number(),
    [proposalId]
  );
  return state;
}
