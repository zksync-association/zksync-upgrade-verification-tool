import {
  createProposal,
  getProposals as getStoredProposals,
  updateProposal,
} from "@/.server/db/dto/proposals";
import { isProposalActive, PROPOSAL_STATES } from "@/utils/proposal-states";
import { bigIntMax } from "@/utils/bigint";
import { l1Rpc } from "./ethereum-l1/client";
import {
  getUpgradeStartedEvents,
  getUpgradeState,
  getUpgradeStatus,
} from "./ethereum-l1/contracts/protocol-upgrade-handler";
import { fetchLogProof, l2Rpc } from "@/.server/service/ethereum-l2/client";
import { zkProtocolGovernorAbi } from "@/utils/contract-abis";
import { env } from "@config/env.server";
import { encodeAbiParameters, type Hex, keccak256, numberToHex, padHex, zeroAddress } from "viem";
import { queryLogs } from "@/.server/service/server-utils";
import { upgradeStructAbi } from "@/utils/emergency-proposals";

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

export type ProposalDataResponse = {
  proposalId: Hex;
} & (
  | {
      ok: true;
      data: {
        l2BatchNumber: Hex;
        l2MessageIndex: Hex;
        l2TxNumberInBatch: Hex;
        proof: Hex[];
        proposal: Hex;
      };
      error: null;
    }
  | {
      ok: false;
      error: string;
      data: null;
    }
);

async function extractProposalData(txHash: Hex, proposalId: Hex): Promise<ProposalDataResponse> {
  if (env.ETH_NETWORK === "local") {
    const data = {
      l2BatchNumber: 0,
      l2MessageIndex: 0,
      l2TxNumberInBatch: 0,
      proof: [txHash],
      proposal: encodeAbiParameters(
        [upgradeStructAbi],
        [
          {
            calls: [],
            executor: zeroAddress,
            salt: padHex("0x0"),
          },
        ]
      ),
    };
    return {
      proposalId,
      data,
      ok: true,
      error: null,
    };
  }

  const receipt = await l2Rpc.getTransactionReceipt({ hash: txHash });
  const logProof = await fetchLogProof(txHash, 0);

  const l1MessageEventId = "0x3a36e47291f4201faf137fab081d92295bce2d53be2c6ca68ba82c7faa9ce241";
  const bodyLog = receipt.logs.find((l) => l.topics[0] === l1MessageEventId);
  if (!bodyLog) {
    return {
      proposalId,
      ok: false,
      error: `No message sent to l1 found for tx ${txHash}`,
      data: null,
    };
  }

  if (!logProof) {
    return {
      proposalId,
      ok: false,
      error: `log proof was not found for tx ${txHash}`,
      data: null,
    };
  }

  if (proposalId !== keccak256(bodyLog.data)) {
    return {
      proposalId,
      ok: false,
      error: "proposalId does not match",
      data: null,
    };
  }

  if (!receipt.l1BatchNumber) {
    return {
      proposalId,
      ok: false,
      error: "missing batch number",
      data: null,
    };
  }

  if (!receipt.l1BatchTxIndex) {
    return {
      proposalId,
      ok: false,
      error: "missing batch tx index",
      data: null,
    };
  }

  return {
    proposalId,
    ok: true,
    error: null,
    data: {
      l2BatchNumber: numberToHex(receipt.l1BatchNumber),
      l2MessageIndex: numberToHex(logProof.id),
      l2TxNumberInBatch: numberToHex(receipt.l1BatchTxIndex),
      proof: logProof.proof,
      proposal: bodyLog.data,
    },
  };
}

export async function searchNotStartedProposals() {
  // First we look for proposals that have already been executed
  // in l2.
  const executedInL2 = await queryLogs(
    zkProtocolGovernorAbi,
    env.ZK_PROTOCOL_GOVERNOR_ADDRESS,
    "ProposalExecuted",
    0n
  );

  // Now we need to check if these events have not been already started in l1
  const filtered = [];
  for (const { args, transactionHash } of executedInL2) {
    const stateInL1 = await getUpgradeState(numberToHex(args.proposalId));
    if (stateInL1 === PROPOSAL_STATES.None) {
      if (!transactionHash) {
        throw new Error("transactionHash should be present");
      }

      filtered.push({
        proposalId: numberToHex(args.proposalId),
        txHash: transactionHash,
      });
    }
  }

  return await Promise.all(
    filtered.map(async ({ txHash, proposalId }) => {
      return extractProposalData(txHash, proposalId);
    })
  );
}
