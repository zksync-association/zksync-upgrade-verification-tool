import {
  type l2CancellationsTable,
  l2CancellationStatusEnum,
  type L2CancellationType,
  l2CancellationTypeEnum,
} from "@/.server/db/schema";
import { bigIntMax } from "@/utils/bigint";
import { badRequest, notFound } from "@/utils/http";
import { isValidCancellationState, } from "@/utils/l2-cancellation-states";
import { env } from "@config/env.server";
import type { InferSelectModel } from "drizzle-orm";
import { hexSchema } from "@repo/common/schemas";
import { type Address, type Hex, } from "viem";
import { db } from "../db";
import { createL2CancellationCall } from "../db/dto/l2-cancellation-calls";
import {
  createOrIgnoreL2Cancellation,
  existActiveProposalWithNonce,
  getL2CancellationByExternalId,
  getL2Cancellations,
  updateL2Cancellation,
} from "../db/dto/l2-cancellations";
import { getLatestBlock } from "./ethereum-l2/client";
import { getGuardiansL2VetoNonce } from "./ethereum-l1/contracts/guardians";
import { getL2ProposalState, lookForActiveProposals } from "@/.server/service/ethereum-l2/contracts/governors";
import { blocksInADay } from "@/.server/service/server-utils";

async function fetchProposalsFromL2Governor(type: L2CancellationType, from: bigint) {
  const activeProposals = await lookForActiveProposals(getL2GovernorAddress(type), from)
    .then(proposals => proposals.map(p => ({ ...p, type }))  )

  const states = await Promise.all(
    activeProposals.map((p) => getL2ProposalState(getL2GovernorAddress(p.type), p.proposalId))
  );

  return activeProposals.filter((_, i) => isValidCancellationState(states[i]));
}

export async function getActiveL2Proposals() {
  const latestBlock = await getLatestBlock();
  // Proposal lifetime is:
  // - 7 days vote delay period
  // - 7 days voting period
  // - 7 days optional extended voting period
  // Another 3 days is added in the calculation to have a conservative
  // estimation of the oldest block with a valid proposal.
  // Max proposal time is calculated in blocks, 1 second per block in L2,
  // therefore 3600 blocks per hour.
  // const maxProposalLifetimeInBlocks = BigInt((21 + 7) * 24 * 3600); // conservative estimation of oldest block with a valid proposal
  const maxProposalLifetimeInBlocks = BigInt((21 + 3) * blocksInADay());

  const from = bigIntMax(latestBlock.number - maxProposalLifetimeInBlocks, 1n);
  const govOpsProposals = await fetchProposalsFromL2Governor(
    l2CancellationTypeEnum.enum.ZK_GOV_OPS_GOVERNOR,
    from
  );
  const tokenProposals = await fetchProposalsFromL2Governor(
    l2CancellationTypeEnum.enum.ZK_TOKEN_GOVERNOR,
    from
  );
  return [...govOpsProposals, ...tokenProposals];
}

export async function getL2VetoNonce(): Promise<number> {
  const bigIntNonce = await getGuardiansL2VetoNonce();
  return Number(bigIntNonce);
}

export async function createVetoProposalFor(
  id: Hex,
  l2GasLimit: Hex,
  l2GasPerPubdataByteLimit: Hex,
  refundRecipient: Hex,
  txMintValue: Hex,
  newNonce: number
) {
  const allActive = await getActiveL2Proposals();
  const proposalData = allActive.find((activeProposal) => activeProposal.proposalId === id);
  if (!proposalData) {
    throw notFound();
  }

  const currentNonce = await getL2VetoNonce();

  if (newNonce < currentNonce) {
    throw badRequest("Nonce too low.");
  }

  if (await existActiveProposalWithNonce(newNonce)) {
    throw badRequest(`There is already an active proposal with ${newNonce} as nonce`);
  }

  await db.transaction(async (tx) => {
    const l2Cancellation = await createOrIgnoreL2Cancellation(
      {
        externalId: proposalData.proposalId,
        proposer: proposalData.proposer,
        description: proposalData.description,
        type: proposalData.type,
        nonce: newNonce,
        status: l2CancellationStatusEnum.enum.ACTIVE,
        txRequestGasLimit: l2GasLimit,
        txRequestTo: getL2GovernorAddress(proposalData.type),
        txRequestL2GasPerPubdataByteLimit: l2GasPerPubdataByteLimit,
        txRequestRefundRecipient: refundRecipient,
        txRequestTxMintValue: txMintValue,
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

export async function getUpdatedL2Cancellations() {
  const currentNonce = await getL2VetoNonce();
  return await getL2Cancellations().then((cancellations) =>
    Promise.all(cancellations.map((c) => upgradeCancellationStatus(c, currentNonce)))
  );
}

export function getL2GovernorAddress(proposalType: L2CancellationType) {
  let l2GovernorAddress: Address;
  switch (proposalType) {
    case "ZK_GOV_OPS_GOVERNOR":
      l2GovernorAddress = env.ZK_GOV_OPS_GOVERNOR_ADDRESS;
      break;
    case "ZK_TOKEN_GOVERNOR":
      l2GovernorAddress = env.ZK_TOKEN_GOVERNOR_ADDRESS;
      break;
    default:
      throw badRequest("Invalid proposalType");
  }
  return l2GovernorAddress;
}

export async function getAndUpdateL2CancellationByExternalId(
  externalId: Hex
): Promise<InferSelectModel<typeof l2CancellationsTable>> {
  const proposal = await getL2CancellationByExternalId(externalId);
  if (!proposal) {
    throw notFound();
  }

  return await upgradeCancellationStatus(proposal, await getL2VetoNonce());
}

async function upgradeCancellationStatus(
  cancellation: InferSelectModel<typeof l2CancellationsTable>,
  currentNonce: number
): Promise<InferSelectModel<typeof l2CancellationsTable>> {
  if (cancellation.status !== l2CancellationStatusEnum.enum.ACTIVE) {
    return cancellation;
  }

  if (hexSchema.safeParse(cancellation.transactionHash).success) {
    cancellation.status = l2CancellationStatusEnum.enum.DONE;
    await updateL2Cancellation(cancellation.id, cancellation);
    return cancellation;
  }

  const state = await getL2ProposalState(cancellation.txRequestTo, cancellation.externalId);
  if (!isValidCancellationState(state)) {
    cancellation.status = l2CancellationStatusEnum.enum.L2_PROPOSAL_EXPIRED;
    await updateL2Cancellation(cancellation.id, cancellation);
    return cancellation;
  }

  if (cancellation.nonce < currentNonce) {
    cancellation.status = l2CancellationStatusEnum.enum.NONCE_TOO_LOW;
    await updateL2Cancellation(cancellation.id, cancellation);
    return cancellation;
  }

  return cancellation;
}
