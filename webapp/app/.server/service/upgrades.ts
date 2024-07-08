import { upgradeHandlerAbi } from "@/.server/service/protocol-upgrade-handler-abi";
import { env } from "@config/env.server";
import { RpcClient } from "validate-cli";
import { type Hex, hexToBigInt, numberToHex } from "viem";
import { z } from "zod";

const upgradeHandlerAddress = env.UPGRADE_HANDLER_ADDRESS;

const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));

const rpc = new RpcClient(env.L1_RPC_URL_FOR_UPGRADES);

enum UpgradeStates {
  None = 0,
  LegalVetoPeriod = 1,
  Waiting = 2,
  ExecutionPending = 3,
  Ready = 4,
  Expired = 5,
  Done = 6,
}

type UpgradeStatus = {
  creationTimestamp: number;
  securityCouncilApprovalTimestamp: number;
  guardiansApproval: boolean;
  guardiansExtendedLegalVeto: boolean;
  executed: boolean;
}

async function getUpgradeState (id: Hex): Promise<UpgradeStates> {
  const stateNumber = await rpc.contractRead(
    upgradeHandlerAddress,
    "upgradeState",
    upgradeHandlerAbi.raw,
    z.number(),
    [id]
  )

  if (stateNumber > 6) {
    throw new Error("Unknown state")
  }

  return stateNumber
}

async function getUpgradeStatus (id: Hex): Promise<UpgradeStatus> {
  const data = await rpc.contractRead(upgradeHandlerAddress, "upgradeStatus", upgradeHandlerAbi.raw, z.tuple([
    z.number(),
    z.number(),
    z.boolean(),
    z.boolean(),
    z.boolean()
  ]), [id])

  return {
    creationTimestamp: data[0],
    securityCouncilApprovalTimestamp: data[1],
    guardiansApproval: data[2],
    guardiansExtendedLegalVeto: data[3],
    executed: data[4]
  }
}

export async function queryNewUpgrades(): Promise<Hex[]> {
  const currentBlock = await rpc.getLatestBlockNumber();
  const currentHeight = hexToBigInt(currentBlock);
  const maxUpgradeLiftimeInBlocks = BigInt(40 * 24 * 360); // conservative estimation of latest block with a valid upgrade

  const from = bigIntMax(currentHeight - maxUpgradeLiftimeInBlocks, 1n);
  const abi = upgradeHandlerAbi;

  await new Promise((resolve) => setTimeout(resolve, 5)); // Avoid anvil crushing for mysterious reasons
  const logs = await rpc.getLogs(upgradeHandlerAddress, numberToHex(from), "latest", [
    abi.eventIdFor("UpgradeStarted"),
  ]);

  const nonResolvedUpgrades: Hex[] = [];

  for (const log of logs) {
    const [_, id] = log.topics;
    const stateNumber = await getUpgradeState(id)

    if (stateNumber !== UpgradeStates.Expired && stateNumber !== UpgradeStates.Done) {
      nonResolvedUpgrades.push(id);
    }
  }

  return nonResolvedUpgrades;
}

function daysInMs(days: number): number {
  return days * 24 * 3600 * 1000
}

export async function nextImportantTime(id: Hex): Promise<{ eventName: string, timestamp: number }> {
  const stateNumber = await getUpgradeState(id)
  const status = await getUpgradeStatus(id)

  const vetoPeriodDuration = status.guardiansExtendedLegalVeto
    ? daysInMs(7)
    : daysInMs(3)

  switch (stateNumber) {
    case UpgradeStates.None:
      throw new Error(`Upgrade does not exist: ${id}`)
    case UpgradeStates.Waiting:
      return { eventName: "gathering_signatures", timestamp: status.creationTimestamp + vetoPeriodDuration + daysInMs(30) }
    case UpgradeStates.LegalVetoPeriod:
      return { eventName: "legal_veto", timestamp: status.creationTimestamp + vetoPeriodDuration }
    case UpgradeStates.Expired:
      return { eventName: "expired", timestamp: 0 }
    case UpgradeStates.Done:
      return { eventName: "done", timestamp: 0 }
    case UpgradeStates.Ready:
      return { eventName: "ready_to_publish", timestamp: 0 }
    case UpgradeStates.ExecutionPending:
      return {
        eventName: "wait_to_publish",
        timestamp: status.securityCouncilApprovalTimestamp !== 0
          ? status.securityCouncilApprovalTimestamp + daysInMs(1)
          : status.creationTimestamp + vetoPeriodDuration + daysInMs(30) + daysInMs(1)

      }
  }
}