import { l2CancellationStatusEnum } from "@/.server/db/schema";
import { guardiansAddress } from "@/.server/service/contracts";
import { hexSchema } from "@/common/basic-schemas";
import { bigIntMax } from "@/utils/bigint";
import { notFound } from "@/utils/http";
import { ALL_ABIS, ZK_GOV_OPS_GOVERNOR_ABI } from "@/utils/raw-abis";
import { env } from "@config/env.server";
import { type Hex, decodeEventLog, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";
import { db } from "../db";
import { createL2CancellationCall } from "../db/dto/l2-cancellation-calls";
import { createOrIgnoreL2Cancellation, getActiveL2Cancellations } from "../db/dto/l2-cancellations";
import { l1Rpc } from "./clients";
import { zkGovOpsGovernorAbi } from "./contract-abis";

const eventSchema = z.object({
  eventName: z.string(),
  args: z.object({
    proposalId: z.bigint().transform((bn) => numberToHex(bn)),
    proposer: hexSchema,
    targets: z.array(hexSchema),
    values: z.array(z.bigint().transform((bn) => numberToHex(bn))),
    signatures: z.array(z.string()),
    calldatas: z.array(hexSchema),
    voteStart: z.bigint().transform((bn) => numberToHex(bn)),
    voteEnd: z.bigint().transform((bn) => numberToHex(bn)),
    description: z.string(),
  }),
});

export async function getActiveL2Proposals() {
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
  return await l1Rpc
    .getLogs(env.ZK_GOV_OPS_GOVERNOR_ADDRESS, numberToHex(from), "latest", [
      zkGovOpsGovernorAbi.eventIdFor("ProposalCreated"),
    ])
    .then((logs) =>
      logs.map((log) => {
        return decodeEventLog({
          abi: ZK_GOV_OPS_GOVERNOR_ABI,
          eventName: "ProposalCreated",
          data: log.data,
          topics: log.topics as any,
        });
      })
    )
    .then((events) =>
      events.map((event) => eventSchema.parse(event)).map((parsedEvent) => parsedEvent.args)
    );
}

async function getL2VetoNonce(): Promise<bigint> {
  return l1Rpc.contractRead(await guardiansAddress(), "nonce", ALL_ABIS.guardians, z.bigint());
}

export async function createVetoProposalFor(id: Hex) {
  const allActive = await getActiveL2Proposals();
  const proposalData = allActive.find((activeProposal) => activeProposal.proposalId === id);
  if (!proposalData) {
    throw notFound();
  }

  const nonce = await getL2VetoNonce();

  await db.transaction(async (tx) => {
    const l2Cancellation = await createOrIgnoreL2Cancellation(
      {
        externalId: proposalData.proposalId,
        proposer: proposalData.proposer,
        description: proposalData.description,
        type: "ZK_GOV_OPS_GOVERNOR",
        nonce: Number(nonce),
        status: l2CancellationStatusEnum.enum.ACTIVE,
      },
      { tx }
    );
    if (l2Cancellation === undefined) {
      return;
    }

    for (const [i, data] of proposalData.calldatas.entries()) {
      const target = proposalData.targets[i];
      const value = proposalData.values[i];
      if (target === undefined || value === undefined) {
        throw new Error("Invalid proposal");
      }
      await createL2CancellationCall(
        {
          data,
          proposalId: l2Cancellation.id,
          target,
          value: value,
        },
        { tx }
      );
    }
  });
}

export async function getZkGovOpsProposals() {
  return getActiveL2Cancellations();
}

// async function getProposalState({
//   proposalId,
//   targetAddress,
// }: { proposalId: bigint; targetAddress: Address }) {
//   return await l2Rpc.contractRead(
//     targetAddress,
//     "state",
//     ZK_GOV_OPS_GOVERNOR_ABI,
//     z.number(),
//     [proposalId]
//   );
// }
