import { type NetworkConfig, knownNetwork, localNetwork } from "@/common/networks";
import { env } from "@config/env.server";
import { type Address, type PublicClient, createPublicClient } from "viem";
import { zksync } from "viem/chains";
import { FOREVER, cached } from "./cache";
import { type Lane, createLane } from "./chain/jsonrpc";
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

export function latestBlock() {
  return cached("latest-block", 4_000, () => l1.getBlock({ blockTag: "latest" }));
}

/** Blocks at or below this height are treated as final and may be cached forever. */
export async function safeBlockNumber(): Promise<bigint> {
  const [net, latest] = await Promise.all([network(), latestBlock()]);
  if (net.isDevNode) return net.forkBlock ?? -1n;
  return latest.number - 64n;
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
