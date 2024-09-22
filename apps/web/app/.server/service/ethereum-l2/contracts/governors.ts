import { l2Rpc } from "@/.server/service/ethereum-l2/client";
import {
  type AbiItemName,
  type Address,
  type ContractEventName,
  decodeEventLog,
  getAbiItem,
  getContract, type Hex, hexToBigInt,
  numberToHex
} from "viem";
import { zkGovOpsGovernorAbi } from "@/utils/contract-abis";
import { z } from "zod";
import { hexSchema } from "@repo/common/schemas";


const governor = (address: Address) =>
  getContract({
    address,
    abi: zkGovOpsGovernorAbi,
    client: l2Rpc,
  });

const createdSchema = z.object({
  proposalId: z.bigint().transform((bn) => numberToHex(bn)),
  proposer: hexSchema,
  targets: z.array(hexSchema),
  values: z.array(z.bigint().transform((bn) => numberToHex(bn))),
  signatures: z.array(z.string()),
  calldatas: z.array(hexSchema),
  voteStart: z.bigint().transform((bn) => numberToHex(bn)),
  voteEnd: z.bigint().transform((bn) => numberToHex(bn)),
  description: z.string(),
});
type ProposalCreatedEvent = z.infer<typeof createdSchema>;

const canceledSchema = z.object({
  proposalId: z.bigint().transform((bn) => numberToHex(bn))
})


function queryEvents(
  address: Address,
  eventName: ContractEventName<typeof zkGovOpsGovernorAbi>,
  fromBlock: bigint
) {
  const asAbiItemName = eventName as AbiItemName<typeof zkGovOpsGovernorAbi>;
  return l2Rpc.getLogs({
    address: address,
    event: getAbiItem({
      abi: zkGovOpsGovernorAbi,
      name: asAbiItemName
    }),
    fromBlock,
    toBlock: "latest"
  }).then((logs) =>
    logs.map((log) => decodeEventLog({
      abi: zkGovOpsGovernorAbi,
      eventName: eventName,
      data: log.data,
      topics: log.topics,
    }))
  );
}

export async function lookForActiveProposals(address: Address, fromBlock: bigint): Promise<ProposalCreatedEvent[]> {
  const createdPromise = await queryEvents(address, "ProposalCreated", fromBlock)
    .then(logs => logs
      .map((event) => createdSchema.parse(event.args))
    )

  const cancelledPromise = await queryEvents(address, "ProposalCanceled", fromBlock)
    .then(logs => logs
      .map(logs => canceledSchema.parse(logs))
      .reduce((acc, curr): Set<Hex> => {
        acc.add(curr.proposalId)
        return acc
      }, new Set<Hex>())
    )

  const executedPromise = await queryEvents(address, "ProposalExecuted", fromBlock)
    .then(logs => logs
      .map(logs => canceledSchema.parse(logs))
      .reduce((acc, curr): Set<Hex> => {
        acc.add(curr.proposalId)
        return acc
      }, new Set<Hex>())
    )

  const [created, canceledSet, executedSet] = await Promise.all([createdPromise, cancelledPromise, executedPromise]);

  return created.filter(
    creation => !canceledSet.has(creation.proposalId) && !executedSet.has(creation.proposalId)
  );
}

export async function getL2ProposalState(address: Hex, proposalId: Hex): Promise<number> {
  return await governor(address).read.state([hexToBigInt(proposalId)])
}