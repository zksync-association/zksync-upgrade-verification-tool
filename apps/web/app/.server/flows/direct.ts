import { upgradeHandlerAbi } from "@/common/abis";
import { type Address, type Hex, type Log, isAddressEqual } from "viem";
import { puhIndex } from "../chain/puh-index";
import { findBlockByTimestamp, getLogs } from "../logs";
import { l1, latestBlock, network, safeBlockNumber } from "../rpc";
import { topicOf } from "./common";
import { type EmergencyEvent, archiveEmergencyEvent } from "./emergency-event";

// One id's event found without the ProtocolUpgradeHandler's log index: from the on-chain
// creation time (an upgrade's start) or by bisecting its state over archive blocks (an emergency
// execution), then reading a few blocks' logs. The legacy lookups when the index cannot answer,
// and, for a page in a process whose index is still reading the history (no history kept from
// the last run either), a first answer beside the index's: labelled "located directly", never
// kept, and checked against the index's answer once it has one.

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

/** The UpgradeStarted log of `id`, found from its on-chain creation time; null when not there. */
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

/**
 * The first log in an RPC's answer to the narrow UpgradeStarted read that is what was asked for:
 * the handler's, the UpgradeStarted event of `id`, not removed, within the blocks asked. An RPC's
 * answer is not taken on trust: a log of another upgrade (or contract) is never shown as this one.
 */
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

/**
 * The EmergencyUpgradeExecuted event of `id` from archive state and that one block's log; null
 * when not found this way (no archive state, or no such event): never a scan of the history.
 */
export async function emergencyEventDirectly(id: Hex): Promise<EmergencyEvent | null> {
  return archiveEmergencyEvent(id, await network(), { scan: false });
}

/**
 * Whether a page's lookup of one event should run a direct lookup beside the index's: the index
 * has not covered the history yet (idle or backfilling) and holds no history from the last run
 * to answer from. Never on dev nodes (the legacy path already serves them), and never when the
 * index is ready or unavailable (the index answers, or its legacy fallback does).
 */
export function directLookupHelps(net: { isDevNode: boolean }): boolean {
  if (net.isDevNode) return false;
  const index = puhIndex();
  const { state } = index.status();
  if (state === "ready" || state === "unavailable") return false;
  return !index.hasLastRunHistory();
}

/** An answer and whether it came from a direct lookup (else from the index). */
export type FirstAnswer<T> = { value: T; direct: boolean };

/**
 * Pages only: the index's answer, or the direct lookup's when it has found the event first. The
 * index decides everything else: its answer (null included) or its error settles this when it
 * comes first, and a direct lookup that fails or finds nothing is ignored.
 */
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
