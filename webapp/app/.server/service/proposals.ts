import { db } from "@/.server/db";
import { upgradesTable } from "@/.server/db/schema";
import { upgradeHandlerAbi } from "@/.server/service/protocol-upgrade-handler-abi";
import { env } from "@config/env.server";
import { RpcClient } from "validate-cli";
import { type Hex, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));

const rpc = new RpcClient(env.L1_RPC_URL_FOR_UPGRADES);

enum PROPOSAL_STATES {
  None = 0,
  // LegalVetoPeriod,
  // Waiting,
  // ExecutionPending,
  // Ready,
  Expired = 5,
  Done = 6,
}

export type Proposal = {
  id: Hex;
};

export async function getPendingProposals(): Promise<Proposal[]> {
  const currentBlock = await rpc.getLatestBlockNumber();
  const currentHeight = hexToBigInt(currentBlock);
  const maxUpgradeLiftimeInBlocks = BigInt(40 * 24 * 360); // conservative estimation of latest block with a valid upgrade

  const from = bigIntMax(currentHeight - maxUpgradeLiftimeInBlocks, 1n);
  const abi = upgradeHandlerAbi;

  await new Promise((resolve) => setTimeout(resolve, 5)); // Avoid anvil crushing for mysterious reasons
  const logs = await rpc.getLogs(upgradeHandlerAddress, numberToHex(from), "latest", [
    abi.eventIdFor("UpgradeStarted"),
  ]);

  const nonResolvedUpgrades: Proposal[] = [];

  for (const log of logs) {
    const [_, id] = log.topics;
    const stateNumber = await rpc.contractRead(
      upgradeHandlerAddress,
      "upgradeState",
      abi.raw,
      z.number(),
      [id]
    );

    if (stateNumber !== PROPOSAL_STATES.Expired && stateNumber !== PROPOSAL_STATES.Done) {
      nonResolvedUpgrades.push({ id });
      await db
        .insert(upgradesTable)
        .values({
          proposalId: id,
          calldata: log.data,
        })
        .onConflictDoNothing({ target: upgradesTable.proposalId });
    }
  }

  return nonResolvedUpgrades;
}
