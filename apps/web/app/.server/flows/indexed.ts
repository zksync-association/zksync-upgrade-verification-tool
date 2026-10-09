import type { Hex } from "viem";
import { IndexIncomplete, IndexUnavailable } from "../chain/log-index";
import { type PuhEvent, type PuhEventName, puhIndex } from "../chain/puh-index";
import { refreshHead } from "../rpc";

// Only an unavailable index (the RPC refused or kept failing eth_getLogs), or a dev node's index
// not covering the range yet, falls back to the legacy lookups; any other failure is reported.
export function indexCannotAnswer(error: unknown, net: { isDevNode: boolean }): boolean {
  return error instanceof IndexUnavailable || (net.isDevNode && error instanceof IndexIncomplete);
}

// The state and the index each read the cached head, and a newer head can be served in between:
// a miss is looked up once more at the newest head. Two events for one id is an error.
export async function expectedEvent<N extends PuhEventName>(
  name: N,
  id: Hex
): Promise<PuhEvent<N> | null> {
  const event = await puhIndex().single(name, id);
  if (event) return event;
  refreshHead();
  return puhIndex().single(name, id);
}

export type Located = { transactionHash: Hex; blockNumber: bigint };

export async function locateEvent(
  name: PuhEventName,
  id: Hex,
  net: { isDevNode: boolean },
  legacy: () => Promise<Located | null>
): Promise<Located | null> {
  try {
    const event = await expectedEvent(name, id);
    return event
      ? { transactionHash: event.log.transactionHash, blockNumber: event.log.blockNumber }
      : null;
  } catch (error) {
    if (indexCannotAnswer(error, net)) return legacy();
    throw error;
  }
}
