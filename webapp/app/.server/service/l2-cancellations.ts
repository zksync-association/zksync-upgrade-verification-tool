import {
  type l2CancellationsTable,
  l2CancellationStatusEnum,
  type L2CancellationType,
  l2CancellationTypeEnum,
} from "@/.server/db/schema";
import { guardiansAddress } from "@/.server/service/contracts";
import { hexSchema } from "@/common/basic-schemas";
import { bigIntMax } from "@/utils/bigint";
import { badRequest, notFound } from "@/utils/http";
import {
  isValidCancellationState,
  type L2_CANCELLATION_STATES,
  VALID_CANCELLATION_STATES,
} from "@/utils/l2-cancellation-states";
import { ALL_ABIS, ZK_GOV_OPS_GOVERNOR_ABI } from "@/utils/raw-abis";
import { env } from "@config/env.server";
import type { InferSelectModel } from "drizzle-orm";
import { type Address, decodeEventLog, type Hex, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";
import { db } from "../db";
import { createL2CancellationCall } from "../db/dto/l2-cancellation-calls";
import {
  createOrIgnoreL2Cancellation,
  getL2CancellationByExternalId,
  getL2Cancellations,
  updateL2Cancellation,
} from "../db/dto/l2-cancellations";
import { l1Rpc, l2Rpc } from "./clients";
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

function blocksInADay() {
  if (env.ETH_NETWORK === "mainnet") {
    return 24 * 3600; // 24 hours, 1 block per second
  }
  return 24 * (3600 / 20); // 20 seconds per block.
}

async function getL2ProposalState(
  type: L2CancellationType,
  proposalId: Hex
): Promise<L2_CANCELLATION_STATES> {
  return l2Rpc.contractRead(
    getL2GovernorAddress(type),
    "state",
    ZK_GOV_OPS_GOVERNOR_ABI,
    z.number(),
    [proposalId]
  );
}

async function fetchProposalsFromL2Governor(type: L2CancellationType, from: bigint) {
  const proposalCreatedLogsPromise = l2Rpc
    .getLogs(getL2GovernorAddress(type), numberToHex(from), "latest", [
      zkGovOpsGovernorAbi.eventIdFor("ProposalCreated"),
    ])
    .then((logs) =>
      logs.map((log) =>
        decodeEventLog({
          abi: ZK_GOV_OPS_GOVERNOR_ABI,
          eventName: "ProposalCreated",
          data: log.data,
          topics: log.topics as any,
        })
      )
    )
    .then((events) =>
      events
        .map((event) => eventSchema.parse(event))
        .map((parsedEvent) => parsedEvent.args)
        .map((event) => ({ ...event, type }))
    );
  const proposalCanceledPromise = l2Rpc
    .getLogs(getL2GovernorAddress(type), numberToHex(from), "latest", [
      zkGovOpsGovernorAbi.eventIdFor("ProposalCanceled"),
    ])
    .then((logs) =>
      logs.map((log) =>
        decodeEventLog({
          abi: ZK_GOV_OPS_GOVERNOR_ABI,
          eventName: "ProposalCanceled",
          data: log.data,
          topics: log.topics as any,
        })
      )
    )
    .then((events) =>
      events.reduce(
        (obj, event) => {
          obj[numberToHex(event.args.proposalId)] = true;
          return obj;
        },
        {} as Record<string, boolean>
      )
    );

  const proposalExecutedPromise = l2Rpc
    .getLogs(getL2GovernorAddress(type), numberToHex(from), "latest", [
      zkGovOpsGovernorAbi.eventIdFor("ProposalExecuted"),
    ])
    .then((logs) =>
      logs.map((log) =>
        decodeEventLog({
          abi: ZK_GOV_OPS_GOVERNOR_ABI,
          eventName: "ProposalExecuted",
          data: log.data,
          topics: log.topics as any,
        })
      )
    )
    .then((events) =>
      events.reduce(
        (obj, event) => {
          obj[numberToHex(event.args.proposalId)] = true;
          return obj;
        },
        {} as Record<string, boolean>
      )
    );

  const [proposalCreatedLogs, proposalCanceled, proposalExecuted] = await Promise.all([
    proposalCreatedLogsPromise,
    proposalCanceledPromise,
    proposalExecutedPromise,
  ]);

  const activeProposals = proposalCreatedLogs.filter(
    (proposal) =>
      proposalCanceled[proposal.proposalId] !== true &&
      proposalExecuted[proposal.proposalId] !== true
  );

  const states = await Promise.all(
    activeProposals.map((p) => getL2ProposalState(p.type, p.proposalId))
  );

  return activeProposals.filter((_, i) =>
    VALID_CANCELLATION_STATES.some((state) => state === states[i])
  );
}

export async function getActiveL2Proposals() {
  const latestBlock = await l2Rpc.getLatestBlock();
  const currentBlock = hexToBigInt(latestBlock.number);

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

  const from = bigIntMax(currentBlock - maxProposalLifetimeInBlocks, 1n);
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

async function getL2VetoNonce(): Promise<bigint> {
  return l1Rpc.contractRead(await guardiansAddress(), "nonce", ALL_ABIS.guardians, z.bigint());
}

export async function createVetoProposalFor(
  id: Hex,
  l2GasLimit: Hex,
  l2GasPerPubdataByteLimit: Hex,
  refundRecipient: Hex,
  txMintValue: Hex
) {
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
        type: proposalData.type,
        nonce: Number(nonce),
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
  const currentNonce = Number(await getL2VetoNonce())
  return await getL2Cancellations()
    .then(cancellations => Promise.all(
      cancellations.map(c => upgradeCancellationStatus(c, currentNonce))
    ));
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

  return await upgradeCancellationStatus(proposal, Number(await getL2VetoNonce()));
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

  const state = await getL2ProposalState(cancellation.type, cancellation.externalId);
  if (!isValidCancellationState(state)) {
    cancellation.status = l2CancellationStatusEnum.enum.EXPIRED;
    await updateL2Cancellation(cancellation.id, cancellation);
  }

  if (cancellation.nonce < currentNonce) {
    cancellation.status = l2CancellationStatusEnum.enum.NONCE_TOO_LOW;
    await updateL2Cancellation(cancellation.id, cancellation);
  }

  return cancellation;
}
