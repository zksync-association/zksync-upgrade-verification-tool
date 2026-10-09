import { upgradeHandlerAbi } from "@/common/abis";
import { UPGRADE_STATES, type UpgradeState } from "@/common/upgrade-states";
import type { Address, Hex } from "viem";
import { cached, seed } from "./cache";
import { type BlockRef, type Network, l1State, latestBlock, network } from "./rpc";

// upgradeState and upgradeStatus of one id, as the ProtocolUpgradeHandler answers them at one
// block. On a live chain both are read at the head and kept per head, keyed by the head's HASH (a
// reorg at the same height is another entry): every reader at that head shares one read, and the
// sync engine reads the known ids ahead of requests under the same keys. Dev nodes, which can be
// rewound or changed in place, read at 'latest' every time.

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

// A load-balanced RPC can name a head one of its backends does not have yet.
const UNKNOWN_BLOCK = /header not found|unknown block|block not found|cannot find block/i;
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
  return cached(upgradeStatusKey(net.chainId, id, head), STATUS_TTL_MS, () =>
    readUpgradeStatus(net.upgradeHandler, id, head.number)
  );
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
    if (blockNumber === undefined || !unknownBlock(error)) throw error;
    // Once, after a moment: the backend that answers next has usually caught up.
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
    answer = await read();
  }
  const [state, raw] = answer;
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

/** The node does not know the block it was asked about (anywhere in the error's cause chain). */
function unknownBlock(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const { details, message, cause } = current as {
      details?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    for (const text of [details, message])
      if (typeof text === "string" && UNKNOWN_BLOCK.test(text.slice(0, 2_000))) return true;
    current = cause;
  }
  return false;
}
