import { upgradeHandlerAbi } from "@/common/abis";
import { type Address, type Hex, type Log, isAddressEqual } from "viem";
import { puhIndex } from "../chain/puh-index";
import { findBlockByTimestamp, getLogs } from "../logs";
import { l1, latestBlock, network, safeBlockNumber } from "../rpc";
import { topicOf } from "./common";
import { type EmergencyEvent, archiveEmergencyEvent } from "./emergency-event";

// One id's event found without the log index: from the on-chain creation time or by bisecting
// state over archive blocks. The legacy lookups, and a page's first answer while the index reads
// the history: labelled "located directly", never kept, checked against the index's answer.

/** The first block mined at or after `timestamp`, by header search (no scan). */
export async function blockAt(timestamp: number): Promise<bigint> {
  const net = await network();
  const head = await latestBlock();
  return findBlockByTimestamp(
    l1,
    BigInt(timestamp),
    net.upgradeHandlerDeployBlock,
    head.number,
    net.isDevNode ? null : { key: "l1", safeHead: await safeBlockNumber() }
  );
}

export async function startedLog(id: Hex, creationTimestamp: number): Promise<Log | null> {
  const net = await network();
  const head = await latestBlock();
  const block = await blockAt(creationTimestamp);
  // Dev chains can share a timestamp across several blocks.
  const toBlock = block + 16n < head.number ? block + 16n : head.number;
  const logs = await getLogs(
    l1,
    { address: net.upgradeHandler, topics: [topicOf(upgradeHandlerAbi, "UpgradeStarted"), id] },
    block,
    toBlock
  );
  return startedLogOf(logs, { address: net.upgradeHandler, id, fromBlock: block, toBlock });
}

/** An RPC's answer is not taken on trust: a log of another upgrade (or contract) is never this one. */
export function startedLogOf(
  logs: readonly Log[],
  {
    address,
    id,
    fromBlock,
    toBlock,
  }: { address: Address; id: Hex; fromBlock: bigint; toBlock: bigint }
): Log | null {
  const topic = topicOf(upgradeHandlerAbi, "UpgradeStarted").toLowerCase();
  return (
    logs.find(
      (log) =>
        !log.removed &&
        isAddressEqual(log.address, address) &&
        log.topics[0]?.toLowerCase() === topic &&
        log.topics[1]?.toLowerCase() === id.toLowerCase() &&
        log.blockNumber !== null &&
        log.blockNumber >= fromBlock &&
        log.blockNumber <= toBlock
    ) ?? null
  );
}

export async function emergencyEventDirectly(id: Hex): Promise<EmergencyEvent | null> {
  return archiveEmergencyEvent(id, await network(), { scan: false });
}

/** Never on dev nodes: the legacy path already serves them. */
export function directLookupHelps(net: { isDevNode: boolean }): boolean {
  if (net.isDevNode) return false;
  const index = puhIndex();
  const { state } = index.status();
  if (state === "ready" || state === "unavailable") return false;
  return !index.hasLastRunHistory();
}

export type FirstAnswer<T> = { value: T; direct: boolean };

// Pages only: the direct lookup wins only by finding the event first; the index's answer (null
// included) or error settles it otherwise, and a failed or empty direct lookup is ignored.
export function firstAnswer<T>(
  indexed: Promise<T>,
  direct: Promise<T | null> | null
): Promise<FirstAnswer<T>> {
  const fromIndex = indexed.then((value) => ({ value, direct: false }));
  if (!direct) return fromIndex;
  return new Promise((resolve, reject) => {
    let settled = false;
    fromIndex.then(
      (answer) => {
        if (settled) return;
        settled = true;
        resolve(answer);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      }
    );
    direct.then(
      (value) => {
        if (settled || value === null) return;
        settled = true;
        resolve({ value, direct: true });
      },
      () => {}
    );
  });
}
