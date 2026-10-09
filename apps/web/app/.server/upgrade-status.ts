import { upgradeHandlerAbi } from "@/common/abis";
import { UPGRADE_STATES, type UpgradeState } from "@/common/upgrade-states";
import { type Address, type Hex, decodeFunctionResult, encodeFunctionData } from "viem";
import { cached, peek, seed } from "./cache";
import { aggregateAllAt } from "./chain/aggregate";
import { isUnknownBlock } from "./chain/call";
import { type BlockRef, type Network, l1State, latestBlock, network } from "./rpc";

// upgradeState and upgradeStatus of one id at one block. On a live chain both are read at the head,
// keyed by its HASH (a reorg at the same height is another entry), in the head's aggregate3, else
// on their own. Dev nodes, which can be rewound or changed in place, read at 'latest' every time.

export type UpgradeStatus = {
  creationTimestamp: number;
  securityCouncilApprovalTimestamp: number;
  guardiansApproval: boolean;
  guardiansExtendedLegalVeto: boolean;
  executed: boolean;
};

export type UpgradeStatusRead = { state: UpgradeState; status: UpgradeStatus };

// Keyed per block; the TTL only bounds how long an entry nobody asks for stays in memory.
const STATUS_TTL_MS = 60_000;

// A load-balanced RPC can name a head one of its backends does not have yet (isUnknownBlock).
const UNKNOWN_BLOCK_RETRY_MS = 300;

type Handler = Pick<Network, "chainId" | "upgradeHandler">;

export const upgradeStatusKey = (chainId: number, id: Hex, head: Pick<BlockRef, "hash">) =>
  `upgrade-status:${chainId}:${id.toLowerCase()}:${head.hash.toLowerCase()}`;

/** States that never change once reached: executed, or expired without approval. */
export const isTerminalState = (state: UpgradeState) =>
  state === UPGRADE_STATES.Done || state === UPGRADE_STATES.Expired;

export async function currentUpgradeStatus(id: Hex): Promise<UpgradeStatusRead> {
  const net = await network();
  if (net.isDevNode) return readUpgradeStatus(net.upgradeHandler, id);
  return upgradeStatusAt(net, id, await latestBlock());
}

function upgradeStatusAt(net: Handler, id: Hex, head: BlockRef): Promise<UpgradeStatusRead> {
  return cached(upgradeStatusKey(net.chainId, id, head), STATUS_TTL_MS, async () => {
    const aggregated = await aggregatedStatus(net.upgradeHandler, id, head);
    return aggregated ?? readUpgradeStatus(net.upgradeHandler, id, head.number);
  });
}

/** The status at `head` from its aggregate3, stored where requests look; null when unknown. */
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

/** Stores a status known for `head` (a terminal state read at a final block); never replaces. */
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
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
    answer = await read();
  }
  const [state, raw] = answer;
  return shapeStatus(state, raw);
}
