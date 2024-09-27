import { l2Rpc } from "@/.server/service/ethereum-l2/client";
import { type Address, getContract, type Hex, hexToBigInt, numberToHex } from "viem";
import { zkGovOpsGovernorAbi } from "@/utils/contract-abis";
import { queryLogs } from "@/.server/service/server-utils";

const governor = (address: Address) =>
  getContract({
    address,
    abi: zkGovOpsGovernorAbi,
    client: l2Rpc,
  });

export async function lookForActiveProposals(address: Address, fromBlock: bigint) {
  const createdPromise = queryLogs(zkGovOpsGovernorAbi, address, "ProposalCreated", fromBlock).then(
    (logs) => logs.map((log) => log.args)
  );

  const cancelledPromise = queryLogs(zkGovOpsGovernorAbi, address, "ProposalCanceled", fromBlock)
    .then((logs) => logs.map((log) => log.args.proposalId))
    .then((proposalIds) => new Set(proposalIds));

  const executedPromise = queryLogs(zkGovOpsGovernorAbi, address, "ProposalExecuted", fromBlock)
    .then((logs) => logs.map((log) => log.args.proposalId))
    .then((proposalIds) => new Set(proposalIds));

  const [created, canceledSet, executedSet] = await Promise.all([
    createdPromise,
    cancelledPromise,
    executedPromise,
  ]);

  return created
    .filter(
      (creation) => !canceledSet.has(creation.proposalId) && !executedSet.has(creation.proposalId)
    )
    .map((raw) => {
      return {
        ...raw,
        proposalId: numberToHex(raw.proposalId),
        values: raw.values.map((v) => numberToHex(v)),
        voteStart: numberToHex(raw.voteStart),
        voteEnd: numberToHex(raw.voteEnd),
      };
    });
}

export async function getL2ProposalState(address: Hex, proposalId: Hex): Promise<number> {
  return await governor(address).read.state([hexToBigInt(proposalId)]);
}
