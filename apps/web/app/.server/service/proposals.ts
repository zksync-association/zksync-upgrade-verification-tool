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
import { fetchL2LogProof, l2Rpc, queryL2Logs } from "@/.server/service/ethereum-l2/client";
import { zkProtocolGovernorAbi } from "@/utils/contract-abis";
import { env } from "@config/env.server";
import {
  decodeAbiParameters,
  type Hex,
  keccak256,
  numberToHex,
  toEventSelector,
  toHex,
} from "viem";
import type { StartUpgradeData } from "@/common/types";
import { defaultLogger } from "@config/log.server";
import { EthereumConfig } from "@config/ethereum.server";

// This variable is used as a super simple
// cache for the latest block queried for new upgrades.
let latestSuccess = 0n;

export async function getProposalsFromL1() {
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

  // Logs are calculated from the last 40 days,
  // as this is a conservative estimation of oldest block with a valid upgrade.
  const blocksInADay = Math.floor((24 * 60 * 60) / EthereumConfig.l1.blockTime);
  const minimumPossibleBlock = bigIntMax(currentBlock - BigInt(40 * blocksInADay), BigInt(0));
  const newestKnownTimestamp =
    storedProposals
      .map((p) => BigInt(p.proposedOn.valueOf()) / 1000n)
      .sort()
      .at(-1) || latestBlock.timestamp;

  const newestKnownBlock =
    currentBlock -
    (latestBlock.timestamp - newestKnownTimestamp) / BigInt(EthereumConfig.l1.blockTime);
  const logs = await getUpgradeStartedEvents({
    fromBlock: bigIntMax(minimumPossibleBlock, newestKnownBlock, latestSuccess),
    toBlock: latestBlock.number,
  });

  // Map l1 proposal ids to l2 proposal ids
  const proposalsL1ToL2Id: { [l1ProposalId: Hex]: Hex } = {};
  const executedInL2 = await getL2ExecutedProposals();

  for (const { proposalId, transactionHash } of executedInL2) {
    const receipt = await l2Rpc.getTransactionReceipt({ hash: transactionHash });
    const l1MessageEventId = toEventSelector("L1MessageSent(address,bytes32,bytes)");
    const bodyLog = receipt.logs.find((l) => l.topics[0] === l1MessageEventId);
    if (!bodyLog) {
      continue;
    }

    const [body] = decodeAbiParameters([{ name: "_", type: "bytes" }], bodyLog.data);
    const l1ProposalId = keccak256(body);
    proposalsL1ToL2Id[l1ProposalId] = toHex(proposalId);
  }

  for (const log of logs) {
    const [_signature, id] = log.topics;
    // TODO: verify in which cases can the log args be undefined
    if (!log.args._proposal) {
      throw new Error("Invalid log");
    }

    // If proposal is already stored, check and update l2 proposal id if available
    const storedProposal = storedProposals.find((p) => p.externalId === id);
    if (storedProposal) {
      if (storedProposal.l2ProposalId) {
        continue;
      }

      const l2ProposalId = proposalsL1ToL2Id[id];
      if (l2ProposalId) {
        await updateProposal({
          id: storedProposal.id,
          l2ProposalId,
        });
      }

      continue;
    }

    const [status, proposedOn] = await Promise.all([
      getUpgradeState(id),
      getUpgradeStatus(id).then((s) => new Date(s.creationTimestamp * 1000)),
    ]);

    await createProposal({
      externalId: id,
      calldata: log.data,
      proposedOn,
      executor: log.args._proposal.executor,
      transactionHash: log.transactionHash,
      status: isProposalActive(status) ? "ACTIVE" : "INACTIVE",
      l2ProposalId: proposalsL1ToL2Id[id],
    });
  }

  latestSuccess = latestBlock.number;
  return getStoredProposals();
}

export type ProposalDataResponse = {
  l2ProposalId: Hex;
} & (
  | {
      ok: true;
      data: StartUpgradeData;
      l1ProposalId: Hex;
      error: null;
    }
  | {
      ok: false;
      error: string;
      data: null;
      l1ProposalId: null;
    }
);

export async function searchNotStartedProposalsFromL2() {
  // First we look for proposals that have already been executed
  // in l2.
  const executedInL2 = await getL2ExecutedProposals();

  // Now we need to check if these events have not been already started in l1
  const filtered = [];
  for (const { proposalId, transactionHash } of executedInL2) {
    const data = await extractProposalData(transactionHash, numberToHex(proposalId));
    if (!data.ok) {
      filtered.push(data);
      continue;
    }

    const stateInL1 = await getUpgradeState(data.l1ProposalId);
    if (stateInL1 === PROPOSAL_STATES.None) {
      filtered.push(data);
    }
  }

  return filtered;
}

async function extractProposalData(txHash: Hex, l2ProposalId: Hex): Promise<ProposalDataResponse> {
  const receipt = await l2Rpc.getTransactionReceipt({ hash: txHash });
  const logProof = await fetchL2LogProof(txHash, 0);

  const l1MessageEventId = toEventSelector("L1MessageSent(address,bytes32,bytes)");
  const bodyLog = receipt.logs.find((l) => l.topics[0] === l1MessageEventId);
  if (!bodyLog) {
    return {
      l2ProposalId: l2ProposalId,
      l1ProposalId: null,
      ok: false,
      error: `No message sent to l1 found for tx ${txHash}`,
      data: null,
    };
  }

  if (!logProof) {
    return {
      l2ProposalId: l2ProposalId,
      l1ProposalId: null,
      ok: false,
      error: `log proof was not found for tx ${txHash}`,
      data: null,
    };
  }

  if (receipt.l1BatchNumber === null) {
    return {
      l2ProposalId: l2ProposalId,
      l1ProposalId: null,
      ok: false,
      error: "missing batch number",
      data: null,
    };
  }

  if (receipt.l1BatchTxIndex === null) {
    defaultLogger.warn(`Missing l1BatchTxIndex for tx ${txHash}`);
  }

  const [body] = decodeAbiParameters([{ name: "_", type: "bytes" }], bodyLog.data);

  return {
    l2ProposalId: l2ProposalId,
    l1ProposalId: keccak256(body),
    ok: true,
    error: null,
    data: {
      l2BatchNumber: numberToHex(receipt.l1BatchNumber),
      l2MessageIndex: numberToHex(logProof.id),
      l2TxNumberInBatch: receipt.l1BatchTxIndex ? numberToHex(receipt.l1BatchTxIndex) : null,
      proof: logProof.proof,
      proposal: body,
    },
  };
}

async function getL2ExecutedProposals() {
  const logs = await queryL2Logs(
    zkProtocolGovernorAbi,
    env.ZK_PROTOCOL_GOVERNOR_ADDRESS,
    "ProposalExecuted",
    0n
  );

  return logs.map((log) => {
    if (!log.transactionHash) {
      throw new Error("Missing transaction hash");
    }

    return {
      proposalId: log.args.proposalId,
      transactionHash: log.transactionHash,
    };
  });
}
