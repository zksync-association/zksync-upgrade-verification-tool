import { type NetworkConfig, knownNetwork, localNetwork } from "@/common/networks";
import { env } from "@config/env.server";
import { type Address, type PublicClient, type Transport, createPublicClient, http } from "viem";
import { zksync } from "viem/chains";
import { FOREVER, cached, concurrencyLimit } from "./cache";

// Public RPCs throttle bursts, so every client funnels requests through a small pool and backs
// off on 429 (viem retries rate-limit errors with exponential delay: 0.5, 1, 2, 4, 8 s).
function limitedHttp(url: string, maxInFlight: number): Transport {
  const base = http(url, { timeout: 30_000, retryCount: 5, retryDelay: 500 });
  const limit = concurrencyLimit(maxInFlight);
  return (args) => {
    const transport = base(args);
    return {
      ...transport,
      request: ((request) => limit(() => transport.request(request))) as typeof transport.request,
    };
  };
}

// Multicall3 is deployed at the same address on mainnet, Sepolia and their forks. Reads made in the
// same tick go out as one aggregate3 eth_call, which keeps a page within public-RPC rate limits.
// None of the batched calls depend on msg.sender.
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const transport = limitedHttp(env.L1_RPC_URL, 8);
const direct = createPublicClient({ transport });
const batched = createPublicClient({
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
    const chainId = await direct.getChainId();
    const clientVersion = await direct
      .request({ method: "web3_clientVersion" })
      .then(String)
      .catch(() => "unknown");
    const multicallCode = await direct.getCode({ address: MULTICALL3 }).catch(() => undefined);
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
        transport: limitedHttp(l2RpcUrl, 4),
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
