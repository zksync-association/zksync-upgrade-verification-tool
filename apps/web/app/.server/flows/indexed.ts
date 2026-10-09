import type { Hex } from "viem";
import { IndexIncomplete, IndexUnavailable } from "../chain/log-index";
import { type PuhEvent, type PuhEventName, puhIndex } from "../chain/puh-index";
import { refreshHead } from "../rpc";

// Per-id lookups in the ProtocolUpgradeHandler's log index, with the legacy bounded lookups as the
// fallback when the index cannot answer.

/**
 * Whether a failed log index read falls back to the legacy, bounded lookups: the index is
 * unavailable (the RPC refused or kept failing eth_getLogs), or on a dev node it does not cover
 * the range yet. Any other failure (a contradiction in the index, a settings change, a live
 * index still backfilling past its wait) is reported as it is.
 */
export function indexCannotAnswer(error: unknown, net: { isDevNode: boolean }): boolean {
  return error instanceof IndexUnavailable || (net.isDevNode && error instanceof IndexIncomplete);
}

/**
 * The one `name` event for `id`, for an event the contract's current state says has happened.
 * That state and the index each read the cached head on their own (dev nodes read the state at
 * 'latest'), and a newer head can be served between the two reads (the sync engine publishes the
 * next block, or the head's 4 s run out), so a miss is looked up once more at the newest head.
 * Null only when that read has no event either. Two events for one id is an error.
 */
export async function expectedEvent<N extends PuhEventName>(
  name: N,
  id: Hex
): Promise<PuhEvent<N> | null> {
  const event = await puhIndex().single(name, id);
  if (event) return event;
  refreshHead();
  return puhIndex().single(name, id);
}

/** Where an event was emitted. */
export type Located = { transactionHash: Hex; blockNumber: bigint };

/**
 * The one `name` event for `id` (one the contract's state says has happened) from the
 * ProtocolUpgradeHandler's log index; `legacy` only when the index cannot answer (see
 * indexCannotAnswer). Two events for one id is an error.
 */
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
