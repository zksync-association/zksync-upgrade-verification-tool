import { upgradeHandlerAbi } from "@/common/abis";
import { UPGRADE_STATES, type UpgradeState } from "@/common/upgrade-states";
import { type Address, type Hex, decodeFunctionResult, encodeFunctionData } from "viem";
import { cached, peek, seed } from "./cache";
import { aggregateAllAt } from "./chain/aggregate";
import { isUnknownBlock } from "./chain/call";
import { type BlockRef, type Network, l1State, latestBlock, network } from "./rpc";

// upgradeState and upgradeStatus of one id, as the ProtocolUpgradeHandler answers them at one
// block. On a live chain both are read at the head and kept per head, keyed by the head's HASH (a
// reorg at the same height is another entry): every reader at that head shares one read, and the
// sync engine reads the known ids ahead of requests under the same keys (its per-block snapshot).
// A read at a head goes out in the head's aggregate3 (chain/aggregate.ts, with whatever else is
// read there); when that cannot answer (a failed sub-call, an answer from another block, a failed
// call), it is read on its own as before. Dev nodes, which can be rewound or changed in place,
// read at 'latest' every time.

export type UpgradeStatus = {
  creationTimestamp: number;
  securityCouncilApprovalTimestamp: number;
  guardiansApproval: boolean;
  guardiansExtendedLegalVeto: boolean;
  executed: boolean;
};

export type UpgradeStatusRead = { state: UpgradeState; status: UpgradeStatus };

// An entry describes one block; requests move on to the next key with the head. The TTL only
// bounds how long an entry nobody asks for any more stays in memory.
const STATUS_TTL_MS = 60_000;

// A load-balanced RPC can name a head one of its backends does not have yet (isUnknownBlock).
const UNKNOWN_BLOCK_RETRY_MS = 300;

type Handler = Pick<Network, "chainId" | "upgradeHandler">;

export const upgradeStatusKey = (chainId: number, id: Hex, head: Pick<BlockRef, "hash">) =>
  `upgrade-status:${chainId}:${id.toLowerCase()}:${head.hash.toLowerCase()}`;

/** States that never change once reached: executed, or expired without approval. */
export const isTerminalState = (state: UpgradeState) =>
  state === UPGRADE_STATES.Done || state === UPGRADE_STATES.Expired;

/** The id's state and status at the current head (dev nodes: at 'latest', read every time). */
export async function currentUpgradeStatus(id: Hex): Promise<UpgradeStatusRead> {
  const net = await network();
  if (net.isDevNode) return readUpgradeStatus(net.upgradeHandler, id);
  return upgradeStatusAt(net, id, await latestBlock());
}

/** The id's state and status at `head`, read at that block and shared by every reader of it. */
export function upgradeStatusAt(net: Handler, id: Hex, head: BlockRef): Promise<UpgradeStatusRead> {
  return cached(upgradeStatusKey(net.chainId, id, head), STATUS_TTL_MS, async () => {
    const aggregated = await aggregatedStatus(net.upgradeHandler, id, head);
    return aggregated ?? readUpgradeStatus(net.upgradeHandler, id, head.number);
  });
}

/**
 * For the sync engine's snapshot: the id's state and status at `head` from the head's aggregate3,
 * stored where requests at that head look (unless one already read it there), or null when it is
 * unknown at the head (nothing stored: requests then read it themselves). Never rejects.
 */
export async function snapshotUpgradeStatus(
  net: Handler,
  id: Hex,
  head: BlockRef
): Promise<UpgradeStatusRead | null> {
  const key = upgradeStatusKey(net.chainId, id, head);
  const held = peek<UpgradeStatusRead>(key);
  if (held) return held.catch(() => null);
  const value = await aggregatedStatus(net.upgradeHandler, id, head);
  if (value) seed(key, value, STATUS_TTL_MS);
  return value;
}

/** Both reads in the head's aggregate3; null when either is unknown there. Never rejects. */
async function aggregatedStatus(
  handler: Address,
  id: Hex,
  head: BlockRef
): Promise<UpgradeStatusRead | null> {
  const names = ["upgradeState", "upgradeStatus"] as const;
  try {
    const results = await aggregateAllAt(
      head,
      names.map((functionName) => ({
        target: handler,
        callData: encodeFunctionData({ abi: upgradeHandlerAbi, functionName, args: [id] }),
      }))
    );
    const [state, raw] = names.map((functionName, i) => {
      const result = results[i];
      if (!result?.success || result.returnData === "0x") throw new Error("unknown");
      return decodeFunctionResult({
        abi: upgradeHandlerAbi,
        functionName,
        data: result.returnData,
      });
    }) as [number, readonly [number, number, boolean, boolean, boolean]];
    return shapeStatus(state, raw);
  } catch {
    return null;
  }
}

function shapeStatus(
  state: number,
  raw: readonly [number, number, boolean, boolean, boolean]
): UpgradeStatusRead {
  return {
    state: state as UpgradeState,
    status: {
      creationTimestamp: raw[0],
      securityCouncilApprovalTimestamp: raw[1],
      guardiansApproval: raw[2],
      guardiansExtendedLegalVeto: raw[3],
      executed: raw[4],
    },
  };
}

/**
 * Stores a status known for `head` without reading it (a terminal state read at a final block,
 * which no later block can change). Never replaces an entry already there.
 */
export function seedUpgradeStatus(net: Handler, id: Hex, head: BlockRef, value: UpgradeStatusRead) {
  seed(upgradeStatusKey(net.chainId, id, head), value, STATUS_TTL_MS);
}

/** Reads the id's state and status at `blockNumber` (or 'latest'), uncached. */
export async function readUpgradeStatus(
  handler: Address,
  id: Hex,
  blockNumber?: bigint
): Promise<UpgradeStatusRead> {
  // Value reads: together they go out as one Multicall3 call per block, on connections of their
  // own (rpc.ts l1State).
  const read = () =>
    Promise.all([
      l1State.readContract({
        address: handler,
        abi: upgradeHandlerAbi,
        functionName: "upgradeState",
        args: [id],
        blockNumber,
      }),
      l1State.readContract({
        address: handler,
        abi: upgradeHandlerAbi,
        functionName: "upgradeStatus",
        args: [id],
        blockNumber,
      }),
    ]);
  let answer: Awaited<ReturnType<typeof read>>;
  try {
    answer = await read();
  } catch (error) {
    if (blockNumber === undefined || !isUnknownBlock(error)) throw error;
    // Once, after a moment: the backend that answers next has usually caught up.
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
    answer = await read();
  }
  const [state, raw] = answer;
  return shapeStatus(state, raw);
}
