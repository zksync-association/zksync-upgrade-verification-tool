import { type NetworkConfig, knownNetwork, localNetwork } from "@/common/networks";
import { env } from "@config/env.server";
import {
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
  createPublicClient,
  hexToBigInt,
  isHex,
  numberToHex,
} from "viem";
import { zksync } from "viem/chains";
import { FOREVER, cached, cachedUntil, invalidate, replace } from "./cache";
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
// Contract state pinned to a block (upgrade states at the head): one aggregate3 per block, each
// in a POST of its own.
const L1_STATE_TRANSPORT: LimitedHttpOptions = { label: "L1-state", maxInFlight: 4, batch: false };
const L2_TRANSPORT: LimitedHttpOptions = { label: "L2", maxInFlight: 4 };

let transport = limitedHttp(env.L1_RPC_URL, L1_TRANSPORT);
let direct = createPublicClient({ transport });
const makeBatched = (transport: Transport) =>
  createPublicClient({
    chain: {
      id: 0,
      name: "l1",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [env.L1_RPC_URL] } },
      contracts: { multicall3: { address: MULTICALL3 } },
    },
    // Value reads only (governance getters, Safe info): verdicts never go through Multicall3
    // (chain/call.ts). Up to 64 KB of calldata per aggregate3.
    batch: { multicall: { batchSize: 65_536, wait: 10 } },
    transport,
  });

let batched = makeBatched(transport);
let useMulticall = false;

/** L1 client: batched through Multicall3 once the chain is known to have it. */
export const l1 = new Proxy({} as PublicClient, {
  get: (_, property) => {
    const client = (useMulticall ? batched : direct) as unknown as Record<PropertyKey, unknown>;
    return client[property];
  },
});

// Its own connections, and no JSON-RPC batching (viem batches per URL across clients): a slow
// 'latest' read on `l1` (governance, Safe info) never shares a POST with a head's state read, so
// it cannot hold that read up (nor, through the sync engine's state step, the next heads' reads).
let stateTransport = limitedHttp(env.L1_RPC_URL, L1_STATE_TRANSPORT);
let stateDirect = createPublicClient({ transport: stateTransport });
let stateBatched = makeBatched(stateTransport);

/** L1 client for contract state at a pinned block (upgrade states); Multicall3 as `l1`. */
export const l1State = new Proxy({} as PublicClient, {
  get: (_, property) => {
    const client = (useMulticall ? stateBatched : stateDirect) as unknown as Record<
      PropertyKey,
      unknown
    >;
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

/**
 * What the node said about the 'finalized' tag: the block, that it does not know the tag (F is
 * then head − 64), or a failure (F is then the last finalized block known, if any).
 */
type FinalizedRead = { block: BlockRef } | { unsupported: true } | { error: unknown };
type Heads = { latest: BlockRef; finalized: FinalizedRead };

// Blocks this deep are treated as final even when the node's 'finalized' tag is further ahead.
const FINALITY_DEPTH = 64n;

// How a node says it does not know the 'finalized' tag: invalid params (-32602, e.g. geth before
// the merge "invalid argument 0: hex string without 0x prefix"), method not found (-32601),
// unknown block (-39001), or another code with that meaning in its text. Internal errors
// (-32603) and -32000 are failures, never "unsupported": a node that is restarting says
// "finalized block not found" and still has a finalized block a moment later.
const UNSUPPORTED_TAG_CODES = new Set([-32602, -32601, -39001]);
const UNSUPPORTED_TAG =
  /(?:unknown|invalid|unsupported) block tag|block tag\b[^\n]{0,40}\b(?:not supported|unsupported|unknown|invalid)/i;

function isUnknownTag(error: RpcError) {
  if (error.code === -32603 || error.code === -32000) return false;
  return UNSUPPORTED_TAG_CODES.has(error.code) || UNSUPPORTED_TAG.test(error.message.slice(0, 500));
}

// The newest finalized block read under the current settings: a failed 'finalized' read falls
// back to it. Finality only moves forward, so an older answer is still a (deeper) boundary.
let knownFinalized: { generation: number; block: BlockRef } | null = null;

function rememberFinalized(block: BlockRef, readGeneration: number) {
  if (readGeneration !== generation) return;
  if (knownFinalized?.generation === generation && knownFinalized.block.number >= block.number)
    return;
  knownFinalized = { generation, block };
}

// The node said it does not know the 'finalized' tag (under these settings).
let tagUnsupported: { generation: number } | null = null;

function finalizedRead(raw: unknown, readGeneration: number): FinalizedRead {
  const block = toBlockRef(raw);
  if (!block) return { error: new Error("The RPC returned no finalized block") };
  rememberFinalized(block, readGeneration);
  return { block };
}

/** Asks the node for its 'finalized' block. Never rejects: a failure is part of the answer. */
function readFinalizedTag(readGeneration: number): Promise<FinalizedRead> {
  return lanes()
    .head.request<unknown>("eth_getBlockByNumber", ["finalized", false])
    .then(
      (raw): FinalizedRead => finalizedRead(raw, readGeneration),
      (error: unknown): FinalizedRead => {
        if (!(error instanceof RpcError && isUnknownTag(error))) return { error };
        if (readGeneration === generation) tagUnsupported = { generation };
        return { unsupported: true };
      }
    );
}

// How long a head read is served before the node is asked again.
const HEAD_TTL_MS = 4_000;
const HEAD_KEY = "latest-block";

// Head reads (requests' and the sync engine's polls alike), numbered in the order they were sent.
let headReads = 0;

// The newest head read under the current settings, by whoever read it, and the number of the
// newest read that named it. A head poll never replaces the cached head with an older one: a
// lower block (a load-balanced RPC can answer from a backend behind), or another block at the
// same height named by an earlier read (an orphan of a reorg the later read already saw).
let newestHead: { generation: number; block: BlockRef; read: number } | null = null;

/** Whether `block`, named by head read number `read`, may stand as the newest head. */
function supersedes(block: BlockRef, read: number): boolean {
  const known = newestHead?.generation === generation ? newestHead : null;
  if (!known) return true;
  if (block.number !== known.block.number) return block.number > known.block.number;
  return block.hash === known.block.hash || read > known.read;
}

function noteHead(block: BlockRef, readGeneration: number, read: number) {
  if (readGeneration !== generation || !supersedes(block, read)) return;
  const known = newestHead?.generation === generation ? newestHead : null;
  const latestRead = known && known.block.hash === block.hash ? Math.max(known.read, read) : read;
  newestHead = { generation, block, read: latestRead };
}

/**
 * The head and the 'finalized' block, read in one JSON-RPC batch so both describe the same moment.
 * Only the head can fail this read: whatever happens to 'finalized' is kept beside it, so the head
 * never waits on or fails with the finality boundary. The sync engine keeps this entry fresh with
 * its own polls (pollHead).
 */
function heads(): Promise<Heads> {
  return cached(HEAD_KEY, HEAD_TTL_MS, async () => {
    const readGeneration = generation;
    const read = ++headReads;
    const [latest, finalized] = await Promise.all([
      lanes().head.request<unknown>("eth_getBlockByNumber", ["latest", false]),
      readFinalizedTag(readGeneration),
    ]);
    const head = toBlockRef(latest);
    if (!head) throw new Error("The RPC returned no latest block");
    noteHead(head, readGeneration, read);
    return { latest: head, finalized };
  });
}

/** A head the sync engine read: what the node said, and how to serve it. */
export type PolledHead = {
  head: BlockRef;
  /**
   * The node's answer for 'finalized' when this poll asked: a block, or null when the node does
   * not know the tag. undefined when the poll did not ask, or the read failed.
   */
  finalized: BlockRef | null | undefined;
  generation: number;
  /** When the node's answer arrived (ms since the epoch). */
  answeredAt: number;
  /** The finality boundary F at this head, as chainHead() computes it (and rejects). */
  boundary(): Promise<bigint>;
  /**
   * The settings are unchanged and no newer head has been seen (a higher block, or another block
   * at this height named by a later read): this head may be served.
   */
  isNewest(): boolean;
  /**
   * Makes this head the cached head (the entry latestBlock() and chainHead() read) until 4 s after
   * the node named it. False (and nothing changes) when the settings changed, a newer head is
   * known (see isNewest), or the answer is already 4 s old.
   */
  publish(): boolean;
  /**
   * Serves this head for another 4 s without asking the node, for a moment the caller knows no
   * newer block can exist yet. False (and nothing changes) when the settings changed or another
   * head (newer, or the same height with another hash) has been seen since.
   */
  confirm(): boolean;
};

/** Serves `heads` for `ttlMs` when it may stand as the newest head (see supersedes). */
function publishHeads(heads: Heads, readGeneration: number, read: number, ttlMs: number): boolean {
  if (readGeneration !== generation || ttlMs <= 0 || !supersedes(heads.latest, read)) return false;
  noteHead(heads.latest, readGeneration, read);
  replace(HEAD_KEY, heads, ttlMs);
  return true;
}

/**
 * For the sync engine: asks the node for its head now. 'finalized' is asked in the same JSON-RPC
 * batch when `withFinalized` (or nothing is known about it yet); otherwise the last real answer
 * stands in, which is never newer than the true boundary. Nothing is served until the caller
 * publishes the answer (after reading what requests at that head need). Rejects when the head
 * cannot be read.
 */
export async function pollHead({ withFinalized }: { withFinalized: boolean }): Promise<PolledHead> {
  const readGeneration = generation;
  const read = ++headReads;
  const known: FinalizedRead | null =
    knownFinalized?.generation === generation
      ? { block: knownFinalized.block }
      : tagUnsupported?.generation === generation
        ? { unsupported: true }
        : null;
  const ask = withFinalized || known === null;
  const [latest, finalized] = await Promise.all([
    lanes().head.request<unknown>("eth_getBlockByNumber", ["latest", false]),
    ask ? readFinalizedTag(readGeneration) : (known as FinalizedRead),
  ]);
  const answeredAt = Date.now();
  const head = toBlockRef(latest);
  if (!head) throw new Error("The RPC returned no latest block");
  const polled: Heads = { latest: head, finalized };
  let boundary: Promise<bigint> | undefined;
  const newest = () => (newestHead?.generation === generation ? newestHead.block : null);
  return {
    head,
    finalized: !ask
      ? undefined
      : "block" in finalized
        ? finalized.block
        : "unsupported" in finalized
          ? null
          : undefined,
    generation: readGeneration,
    answeredAt,
    boundary: () => {
      boundary ??= network().then((net) => boundaryOf(net, polled));
      return boundary;
    },
    isNewest: () => readGeneration === generation && supersedes(head, read),
    // Served for 4 s from the node's answer, as a request's own read would be: never longer
    // because the engine published it later.
    publish: () =>
      publishHeads(polled, readGeneration, read, HEAD_TTL_MS - (Date.now() - answeredAt)),
    confirm: () => {
      if (readGeneration !== generation) return false;
      const known = newest();
      if (known && known.hash !== head.hash) return false;
      // The caller vouches for this moment: 4 s from now.
      return publishHeads(polled, readGeneration, read, HEAD_TTL_MS);
    },
  };
}

// One fresh 'finalized' read at a time, for a boundary needed after a failed read with nothing
// known to fall back to.
let rereading: { generation: number; read: Promise<FinalizedRead> } | null = null;

function rereadFinalized(): Promise<FinalizedRead> {
  if (rereading?.generation === generation) return rereading.read;
  const readGeneration = generation;
  const read = readFinalizedTag(readGeneration).finally(() => {
    if (rereading?.read === read) rereading = null;
  });
  rereading = { generation: readGeneration, read };
  return read;
}

/**
 * The finalized block for the boundary: this read's, else (it failed) the newest one known under
 * these settings, else one fresh read. null: the node does not know the tag. Rejects when there
 * is no real answer: head − 64 is never assumed for a failure.
 */
async function finalizedFor(read: FinalizedRead): Promise<BlockRef | null> {
  let answer = read;
  if ("error" in answer) {
    if (knownFinalized?.generation === generation) return knownFinalized.block;
    answer = await rereadFinalized();
  }
  if ("block" in answer) return answer.block;
  if ("unsupported" in answer) return null;
  throw answer.error;
}

function toBlockRef(raw: unknown): BlockRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { number, hash, parentHash, timestamp } = raw as Record<string, unknown>;
  if (!isHex(number) || !isHex(hash) || !isHex(parentHash) || !isHex(timestamp)) return null;
  return { number: hexToBigInt(number), hash, parentHash, timestamp: hexToBigInt(timestamp) };
}

/** The chain head (4 s TTL). Never depends on the 'finalized' answer. */
export async function latestBlock(): Promise<BlockRef> {
  return (await heads()).latest;
}

/**
 * The node's 'finalized' block (from the same read as the head when it answered; see finalizedFor
 * when it did not), or null when the node does not know the tag.
 */
export async function finalizedBlock(): Promise<BlockRef | null> {
  return finalizedFor((await heads()).finalized);
}

/**
 * The head and the finality boundary F: blocks at or below F are treated as final and may be
 * cached forever. F = min(head − 64, finalized); head − 64 when the node does not know the tag; on
 * dev nodes, the fork block (without waiting on 'finalized'). Rejects when 'finalized' failed and
 * no finalized block is known.
 */
export async function chainHead(): Promise<{ head: BlockRef; safe: bigint }> {
  const [net, read] = await Promise.all([network(), heads()]);
  return { head: read.latest, safe: await boundaryOf(net, read) };
}

/** F for a head read (see chainHead). */
async function boundaryOf(net: Network, { latest, finalized }: Heads): Promise<bigint> {
  if (net.isDevNode) return net.forkBlock ?? -1n;
  const byDepth = latest.number - FINALITY_DEPTH;
  const final = await finalizedFor(finalized);
  return final && final.number < byDepth ? final.number : byDepth;
}

/** Blocks at or below this height are treated as final and may be cached forever. */
export async function safeBlockNumber(): Promise<bigint> {
  return (await chainHead()).safe;
}

/** Drops the cached head, so the next read asks the node for its newest block. */
export function refreshHead() {
  invalidate(HEAD_KEY);
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
// eth_call/eth_getCode verdict reads, `head` the 'latest'/'finalized' reads (requests' and the
// sync engine's polls). Each lane batches and adapts on its own, so a backfill never queues ahead
// of a page's reads, and a head read never shares a POST with (or waits on) a slow eth_call.
type L1Lanes = { history: Lane; call: Lane; head: Lane };
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
    // One head read ('latest' with 'finalized') per POST.
    head: createLane({ url: env.L1_RPC_URL, label: "l1-head", maxBatch: 2, maxInFlight: 4 }),
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
  knownFinalized = null;
  tagUnsupported = null;
  newestHead = null;
  rereading = null;
  transport = limitedHttp(env.L1_RPC_URL, L1_TRANSPORT);
  direct = createPublicClient({ transport });
  batched = makeBatched(transport);
  stateTransport = limitedHttp(env.L1_RPC_URL, L1_STATE_TRANSPORT);
  stateDirect = createPublicClient({ transport: stateTransport });
  stateBatched = makeBatched(stateTransport);
  useMulticall = false;
  l2Client = undefined;
  l1Lanes?.history.close();
  l1Lanes?.call.close();
  l1Lanes?.head.close();
  l1Lanes = undefined;
  l2History?.close();
  l2History = undefined;
}
