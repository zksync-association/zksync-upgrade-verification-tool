import { type NetworkConfig, knownNetwork, localNetwork } from "@/common/networks";
import { env } from "@config/env.server";
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  hexToBigInt,
  isHex,
  numberToHex,
} from "viem";
import { zksync } from "viem/chains";
import { FOREVER, cached, cachedUntil, invalidate } from "./cache";
import { type Lane, RpcError, createLane } from "./chain/jsonrpc";
import { type LimitedHttpOptions, limitedHttp } from "./rpc-transport";

// Public RPCs throttle bursts, so every client funnels requests through a small pool and backs
// off on 429 (viem retries rate-limit errors with exponential delay: 0.5, 1, 2, 4, 8 s).
// Multicall3 is deployed at the same address on mainnet, Sepolia and their forks. Reads made in the
// same tick go out as one aggregate3 eth_call, which keeps a page within public-RPC rate limits.
// None of the batched calls depend on msg.sender.
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Up to two batches of 8 in flight, so a fan-out above 8 reads does not wait for a whole round trip.
const L1_TRANSPORT: LimitedHttpOptions = { label: "L1", maxInFlight: 16, batchSize: 8 };
const L2_TRANSPORT: LimitedHttpOptions = { label: "L2", maxInFlight: 4 };

let transport = limitedHttp(env.L1_RPC_URL, L1_TRANSPORT);
let direct = createPublicClient({ transport });
const makeBatched = () =>
  createPublicClient({
    chain: {
      id: 0,
      name: "l1",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [env.L1_RPC_URL] } },
      contracts: { multicall3: { address: MULTICALL3 } },
    },
    batch: { multicall: { wait: 10 } },
    transport,
  });

let batched = makeBatched();
let useMulticall = false;

/** L1 client: batched through Multicall3 once the chain is known to have it. */
export const l1 = new Proxy({} as PublicClient, {
  get: (_, property) => {
    const client = (useMulticall ? batched : direct) as unknown as Record<PropertyKey, unknown>;
    return client[property];
  },
});

export type Network = NetworkConfig & {
  upgradeHandler: Address;
  safeTxServiceUrl: string | null;
  l2RpcUrl: string | null;
  // anvil/hardhat: blocks can be rewound, so nothing newer than the fork block is cached.
  isDevNode: boolean;
  // On a fork, blocks up to here are the forked chain's history and never change.
  forkBlock: bigint | null;
  clientVersion: string;
  // Pinned values replaced through env vars. Shown in the UI: a non-default trust anchor
  // should never go unnoticed.
  overrides: string[];
};

export class ConfigError extends Error {}

export function network(): Promise<Network> {
  return cached("network", FOREVER, async () => {
    const [chainId, clientVersion, multicallCode] = await Promise.all([
      direct.getChainId(),
      direct
        .request({ method: "web3_clientVersion" })
        .then(String)
        .catch(() => "unknown"),
      direct.getCode({ address: MULTICALL3 }).catch(() => undefined),
    ]);
    useMulticall = !!multicallCode && multicallCode !== "0x";
    const base = knownNetwork(chainId) ?? localNetwork(chainId);
    const overrides: string[] = [];
    const override = <T>(name: string, value: T | undefined, pinned: T): T => {
      if (value === undefined || value === pinned) return pinned;
      overrides.push(name);
      return value;
    };

    const upgradeHandler = override(
      "UPGRADE_HANDLER_ADDRESS",
      env.UPGRADE_HANDLER_ADDRESS,
      base.upgradeHandler
    );
    if (!upgradeHandler) {
      throw new ConfigError(
        `Chain ${chainId} has no pinned ProtocolUpgradeHandler. Set UPGRADE_HANDLER_ADDRESS (only mainnet and Sepolia are built in).`
      );
    }

    const isDevNode = /anvil|hardhat|ganache/i.test(clientVersion);
    return {
      ...base,
      upgradeHandler,
      safeTxServiceUrl: override(
        "SAFE_TX_SERVICE_URL",
        env.SAFE_TX_SERVICE_URL,
        base.safeTxServiceUrl
      ),
      l2RpcUrl: env.L2_RPC_URL ?? base.l2RpcUrl,
      l2Governors: {
        protocol: override(
          "ZK_PROTOCOL_GOVERNOR_ADDRESS",
          env.ZK_PROTOCOL_GOVERNOR_ADDRESS,
          base.l2Governors.protocol
        ),
        token: override(
          "ZK_TOKEN_GOVERNOR_ADDRESS",
          env.ZK_TOKEN_GOVERNOR_ADDRESS,
          base.l2Governors.token
        ),
        govOps: override(
          "ZK_GOV_OPS_GOVERNOR_ADDRESS",
          env.ZK_GOV_OPS_GOVERNOR_ADDRESS,
          base.l2Governors.govOps
        ),
      },
      isDevNode,
      forkBlock: isDevNode ? await forkBlockOf() : null,
      clientVersion,
      overrides,
    };
  });
}

async function forkBlockOf(): Promise<bigint | null> {
  const anvil = await direct
    .request({ method: "anvil_nodeInfo" } as never)
    .then(
      (info) => (info as { forkConfig?: { forkBlockNumber?: number } }).forkConfig?.forkBlockNumber
    )
    .catch(() => undefined);
  if (anvil !== undefined) return BigInt(anvil);
  const hardhat = await direct
    .request({ method: "hardhat_metadata" } as never)
    .then(
      (m) => (m as { forkedNetwork?: { forkBlockNumber?: number } }).forkedNetwork?.forkBlockNumber
    )
    .catch(() => undefined);
  return hardhat !== undefined ? BigInt(hardhat) : null;
}

let l2Client: PublicClient | null | undefined;

/** ZKsync Era client, or null when no L2 RPC is configured (local chains). */
export async function l2(): Promise<PublicClient | null> {
  if (l2Client !== undefined) return l2Client;
  const { l2RpcUrl } = await network();
  // The zksync chain only adds Era's receipt formatters (l1BatchNumber, l1BatchTxIndex).
  l2Client = l2RpcUrl
    ? (createPublicClient({
        chain: zksync,
        transport: limitedHttp(l2RpcUrl, L2_TRANSPORT),
      }) as unknown as PublicClient)
    : null;
  return l2Client;
}

/** The parts of a block header the app reads. */
export type BlockRef = { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint };
type Heads = { latest: BlockRef; finalized: BlockRef | null };

// Blocks this deep are treated as final even when the node's 'finalized' tag is further ahead.
const FINALITY_DEPTH = 64n;

// How a node says it does not know the 'finalized' tag: geth before the merge "invalid argument
// 0: hex string without 0x prefix" (-32602), hardhat "invalid block tag", a fresh devnet
// "finalized block not found". Anything else (-32603, a rate limit) is a failure, not an answer.
const UNKNOWN_TAG = /finalized|block tag|unknown block|not supported|unsupported/i;

function isUnknownTag(error: RpcError) {
  return (
    error.code === -32602 || error.code === -32601 || UNKNOWN_TAG.test(error.message.slice(0, 500))
  );
}

/**
 * The head and the 'finalized' block, read in one JSON-RPC batch so both describe the same moment.
 * A node that does not know the 'finalized' tag answers it with an error: that block is null.
 */
function heads(): Promise<Heads> {
  return cached("latest-block", 4_000, async () => {
    const { call } = lanes();
    const [latest, finalized] = await Promise.all([
      call.request<unknown>("eth_getBlockByNumber", ["latest", false]),
      call
        .request<unknown>("eth_getBlockByNumber", ["finalized", false])
        // Only an answer that the tag is unknown means it is unsupported. Any other failure
        // (transport, -32603, rate limit) fails the whole read, so the boundary never silently
        // falls back to head − 64.
        .catch((error: unknown) => {
          if (error instanceof RpcError && isUnknownTag(error)) return null;
          throw error;
        }),
    ]);
    const head = toBlockRef(latest);
    if (!head) throw new Error("The RPC returned no latest block");
    return { latest: head, finalized: toBlockRef(finalized) };
  });
}

function toBlockRef(raw: unknown): BlockRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { number, hash, parentHash, timestamp } = raw as Record<string, unknown>;
  if (!isHex(number) || !isHex(hash) || !isHex(parentHash) || !isHex(timestamp)) return null;
  return { number: hexToBigInt(number), hash, parentHash, timestamp: hexToBigInt(timestamp) };
}

/** The chain head (4 s TTL). */
export async function latestBlock(): Promise<BlockRef> {
  return (await heads()).latest;
}

/** The node's 'finalized' block from the same read as the head, or null without the tag. */
export async function finalizedBlock(): Promise<BlockRef | null> {
  return (await heads()).finalized;
}

/**
 * The head and the finality boundary F from one read: blocks at or below F are treated as final
 * and may be cached forever. F = min(head − 64, finalized); on dev nodes, the fork block.
 */
export async function chainHead(): Promise<{ head: BlockRef; safe: bigint }> {
  const [net, { latest, finalized }] = await Promise.all([network(), heads()]);
  if (net.isDevNode) return { head: latest, safe: net.forkBlock ?? -1n };
  const byDepth = latest.number - FINALITY_DEPTH;
  return {
    head: latest,
    safe: finalized && finalized.number < byDepth ? finalized.number : byDepth,
  };
}

/** Blocks at or below this height are treated as final and may be cached forever. */
export async function safeBlockNumber(): Promise<bigint> {
  return (await chainHead()).safe;
}

/** Drops the cached head, so the next read asks the node for its newest block. */
export function refreshHead() {
  invalidate("latest-block");
}

/**
 * Timestamps of L1 blocks, read together (the call lane sends them as one JSON-RPC batch). A
 * block at or below the finality boundary never changes, so its timestamp is kept for good (not
 * on dev nodes, which can be rewound).
 */
export async function blockTimestamps(numbers: readonly bigint[]): Promise<Map<bigint, bigint>> {
  const unique = [...new Set(numbers)];
  if (unique.length === 0) return new Map();
  const [net, { safe }] = await Promise.all([network(), chainHead()]);
  const times = await Promise.all(
    unique.map((n) =>
      cachedUntil(`block-ts:${net.chainId}:${n}`, async () => {
        const block = toBlockRef(
          await lanes().call.request("eth_getBlockByNumber", [numberToHex(n), false])
        );
        if (!block || block.number !== n) throw new Error(`The RPC returned no block ${n}`);
        return { value: block.timestamp, ttlMs: !net.isDevNode && n <= safe ? FOREVER : 0 };
      })
    )
  );
  return new Map(unique.map((n, i) => [n, times[i] as bigint]));
}

// Raw JSON-RPC lanes (chain/jsonrpc.ts). `history` carries eth_getLogs backfills, `call` the
// eth_call/eth_getCode verdict reads. Each lane batches and adapts on its own, so a backfill never
// queues ahead of a page's reads.
type L1Lanes = { history: Lane; call: Lane };
let l1Lanes: L1Lanes | undefined;
let l2History: Lane | null | undefined;
let generation = 0;

/** L1 lanes for the current data source settings. */
export function lanes(): L1Lanes {
  l1Lanes ??= {
    history: createLane({
      url: env.L1_RPC_URL,
      label: "l1-history",
      maxBatch: 25,
      maxInFlight: 8,
    }),
    call: createLane({ url: env.L1_RPC_URL, label: "l1-call", maxBatch: 20, maxInFlight: 8 }),
  };
  return l1Lanes;
}

/** eth_getLogs lane for ZKsync Era, or null when no L2 RPC is configured. */
export async function l2HistoryLane(): Promise<Lane | null> {
  if (l2History !== undefined) return l2History;
  const started = generation;
  const { l2RpcUrl } = await network();
  // The settings changed while the network was read: answer for the new settings.
  if (started !== generation) return l2HistoryLane();
  l2History ??= l2RpcUrl
    ? createLane({ url: l2RpcUrl, label: "l2-history", maxBatch: 20, maxInFlight: 4 })
    : null;
  return l2History;
}

/**
 * The eth_getLogs lane behind a client from this module (`l1`, or the client `l2()` made), so
 * log scans batch on their own lane instead of the client's shared transport. null for any
 * other client.
 */
export async function historyLaneOf(client: unknown): Promise<Lane | null> {
  if (client === l1) return lanes().history;
  if (client && client === l2Client) return l2HistoryLane();
  return null;
}

/** Bumped by every settings change. Results computed under an older generation are stale. */
export function rpcGeneration(): number {
  return generation;
}

/** Recreate clients after a local settings change. Call with cleared chain/log caches. */
export function resetRpcClients() {
  generation++;
  transport = limitedHttp(env.L1_RPC_URL, L1_TRANSPORT);
  direct = createPublicClient({ transport });
  batched = makeBatched();
  useMulticall = false;
  l2Client = undefined;
  l1Lanes?.history.close();
  l1Lanes?.call.close();
  l1Lanes = undefined;
  l2History?.close();
  l2History = undefined;
}
