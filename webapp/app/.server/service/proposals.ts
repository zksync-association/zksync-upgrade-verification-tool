import { createOrIgnoreProposal } from "@/.server/db/dto/proposals";
import {
  upgradeHandlerAbi,
} from "@/.server/service/contract-abis";
import { PROPOSAL_STATES } from "@/utils/proposal-states";
import { env } from "@config/env.server";
import { RpcClient } from "validate-cli";
import { type Hex, decodeEventLog, hexToBigInt, hexToNumber, numberToHex } from "viem";
import { z } from "zod";
import { PROTOCOL_UPGRADE_HANDLER_RAW_ABI } from "@/utils/raw-abis";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));

const rpc = new RpcClient(env.L1_RPC_URL_FOR_UPGRADES);

export type Proposal = {
  id: Hex;
};

export async function getPendingProposals(): Promise<Proposal[]> {
  const currentBlock = await rpc.getLatestBlockNumber();
  const currentHeight = hexToBigInt(currentBlock);
  const maxUpgradeLiftimeInBlocks = BigInt(40 * 24 * 360); // conservative estimation of latest block with a valid upgrade

  const from = bigIntMax(currentHeight - maxUpgradeLiftimeInBlocks, 1n);
  const abi = upgradeHandlerAbi;

  //FIXME: remove
  await new Promise((resolve) => setTimeout(resolve, 5)); // Avoid anvil crushing for mysterious reasons
  const logs = await rpc.getLogs(upgradeHandlerAddress, numberToHex(from), "latest", [
    abi.eventIdFor("UpgradeStarted"),
  ]);

  const nonResolvedUpgrades: Proposal[] = [];

  for (const log of logs) {
    const [signature, id] = log.topics;
    if (!signature || !id) {
      throw new Error("Invalid log");
    }
    const stateNumber = await getProposalStatus(id);

    const proposal = decodeEventLog({
      abi: PROTOCOL_UPGRADE_HANDLER_RAW_ABI,
      eventName: "UpgradeStarted",
      data: log.data,
      topics: [signature, id],
    });

    if (stateNumber !== PROPOSAL_STATES.Expired && stateNumber !== PROPOSAL_STATES.Done) {
      nonResolvedUpgrades.push({ id });
      await createOrIgnoreProposal({
        externalId: id,
        calldata: log.data,
        proposedOn: new Date(hexToNumber(log.blockTimestamp) * 1000),
        executor: proposal.args._proposal.executor,
      });
    }
  }

  return nonResolvedUpgrades;
}

export async function getProposalStatus(id: Hex) {
  const stateNumber = await rpc.contractRead(
    upgradeHandlerAddress,
    "upgradeState",
    upgradeHandlerAbi.raw,
    z.number(),
    [id]
  );
  return stateNumber;
}
