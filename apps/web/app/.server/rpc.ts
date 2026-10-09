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
import { FOREVER, cached, cachedUntil, invalidate, peek, replace } from "./cache";
import { type Lane, RpcError, createLane } from "./chain/jsonrpc";
import { type LimitedHttpOptions, limitedHttp } from "./rpc-transport";
import { countUpstream } from "./sync/cost";
import { creditsOf, paceEngineRequest } from "./sync/pacer";

// Public RPCs throttle bursts, so every client funnels requests through a small pool and backs
// off on 429 (viem retries rate-limit errors with exponential delay: 0.5, 1, 2, 4, 8 s).
// Multicall3 is deployed at the same address on mainnet, Sepolia and their forks. Reads made in the
// same tick go out as one aggregate3 eth_call, which keeps a page within public-RPC rate limits.
// None of the batched calls depend on msg.sender.
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Up to two batches of 8 in flight, so a fan-out above 8 reads does not wait for a whole round trip.
// Every request sent is counted for /api/status (sync.engine.cost), L1 ones with their Infura
// credit weight (an estimate).
const countL1Method = (method: string) => countUpstream("l1", 1, creditsOf(method));
const countL1 = (n: number, methods: readonly string[]) =>
  countUpstream(
    "l1",
    n,
    methods.reduce((sum, method) => sum + creditsOf(method), 0)
  );
const countL2 = (n = 1) => countUpstream("l2", n);
const L1_TRANSPORT: LimitedHttpOptions = {
  label: "L1",
  maxInFlight: 16,
  batchSize: 8,
  onRequest: countL1Method,
  pace: paceEngineRequest,
};
// Contract state pinned to a block (upgrade states at the head): one aggregate3 per block, each
// in a POST of its own.
const L1_STATE_TRANSPORT: LimitedHttpOptions = {
  label: "L1-state",
  maxInFlight: 4,
  batch: false,
  onRequest: countL1Method,
  pace: paceEngineRequest,
};
const L2_TRANSPORT: LimitedHttpOptions = {
  label: "L2",
  maxInFlight: 4,
  onRequest: () => countL2(),
};

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

// The network as last read under the current settings, for what needs it without waiting
// (resolvedNetwork): set once network() has answered, never guessed.
let settledNetwork: { generation: number; net: Network } | null = null;

/**
 * The network network() answered under the current settings, or null while it has not (a fresh
 * process, or right after a settings change). Never reads anything.
 */
export function resolvedNetwork(): Network | null {
  return settledNetwork?.generation === generation ? settledNetwork.net : null;
}

export function network(): Promise<Network> {
  return cached("network", FOREVER, async () => {
    const readGeneration = generation;
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
    const net: Network = {
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
    if (readGeneration === generation) settledNetwork = { generation: readGeneration, net };
    return net;
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

/** A chain's newest head read under some settings, and the number of the newest read naming it. */
type NewestHead = { generation: number; block: BlockRef; read: number };

/**
 * Whether `block`, named by head read number `read`, may stand as the newest head after `known`
 * (under the current settings): a higher block, or the same block, or another block at the same
 * height named by a later read (the earlier one named an orphan of a reorg the later read saw).
 */
function supersedesHead(known: NewestHead | null, block: BlockRef, read: number): boolean {
  const current = known?.generation === generation ? known : null;
  if (!current) return true;
  if (block.number !== current.block.number) return block.number > current.block.number;
  return block.hash === current.block.hash || read > current.read;
}

/** `known` after head read `read`, sent under `readGeneration`, named `block`. */
function withHead(
  known: NewestHead | null,
  block: BlockRef,
  readGeneration: number,
  read: number
): NewestHead | null {
  if (readGeneration !== generation || !supersedesHead(known, block, read)) return known;
  const current = known?.generation === generation ? known : null;
  const latestRead =
    current && current.block.hash === block.hash ? Math.max(current.read, read) : read;
  return { generation, block, read: latestRead };
}

// The newest head read under the current settings, by whoever read it. A head poll never
// replaces the cached head with an older one: a lower block (a load-balanced RPC can answer from
// a backend behind), or another block at the same height named by an earlier read.
let newestHead: NewestHead | null = null;

/** Whether `block`, named by head read number `read`, may stand as the newest head. */
function supersedes(block: BlockRef, read: number): boolean {
  return supersedesHead(newestHead, block, read);
}

function noteHead(block: BlockRef, readGeneration: number, read: number) {
  newestHead = withHead(newestHead, block, readGeneration, read);
}

/** One read of the head (and 'finalized', when it asked) sent to the node. */
type HeadRead = {
  generation: number;
  /** Its number among head reads. */
  read: number;
  /** When it was sent (ms since the epoch). */
  sentAt: number;
  /** It asked for 'finalized' (else the last real answer stands in, see readHeads). */
  asksFinalized: boolean;
  answer: Promise<{ heads: Heads; answeredAt: number }>;
};

// The head read in flight: a request's (heads()) and the sync engine's poll share it, so the
// first request after a pause and the engine waking for it ask the node once, not twice.
let headInFlight: HeadRead | null = null;

/**
 * Asks the node for its head, in one JSON-RPC batch with 'finalized' when `finalized` (or nothing
 * is known about it yet); otherwise the last real 'finalized' answer stands in, which is never
 * newer than the true boundary. Joins the read in flight under these settings instead when it
 * asked for 'finalized', or when `joinWithout` accepts one that did not (its stand-in).
 */
function readHeads(finalized: boolean, joinWithout: boolean): HeadRead {
  const flight = headInFlight;
  if (flight?.generation === generation && (flight.asksFinalized || joinWithout)) return flight;
  const readGeneration = generation;
  const read = ++headReads;
  const known: FinalizedRead | null =
    knownFinalized?.generation === generation
      ? { block: knownFinalized.block }
      : tagUnsupported?.generation === generation
        ? { unsupported: true }
        : null;
  const ask = finalized || known === null;
  const sentAt = Date.now();
  const answer = Promise.all([
    lanes().head.request<unknown>("eth_getBlockByNumber", ["latest", false]),
    ask ? readFinalizedTag(readGeneration) : (known as FinalizedRead),
  ]).then(([latest, final]) => {
    const head = toBlockRef(latest);
    if (!head) throw new Error("The RPC returned no latest block");
    return { heads: { latest: head, finalized: final }, answeredAt: Date.now() };
  });
  const next: HeadRead = { generation: readGeneration, read, sentAt, asksFinalized: ask, answer };
  headInFlight = next;
  const done = () => {
    if (headInFlight === next) headInFlight = null;
  };
  answer.then(done, done);
  return next;
}

/**
 * The head and the 'finalized' block, read in one JSON-RPC batch so both describe the same moment.
 * Only the head can fail this read: whatever happens to 'finalized' is kept beside it, so the head
 * never waits on or fails with the finality boundary. The sync engine keeps this entry fresh with
 * its own polls (pollHead); a poll in flight when this needs a read is joined (its 'finalized' is
 * the one it asked for, or the last real answer: never newer than the true boundary).
 */
function heads(): Promise<Heads> {
  return cached(HEAD_KEY, HEAD_TTL_MS, async () => {
    const flight = readHeads(true, true);
    const { heads: read } = await flight.answer;
    noteHead(read.latest, flight.generation, flight.read);
    return read;
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
  /**
   * When the read was sent (ms since the epoch): earlier than the poll when it joined a request's
   * read already in flight.
   */
  sentAt?: number;
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
 * stands in, which is never newer than the true boundary. A head read already in flight (a
 * request's) is joined instead when it serves (see readHeads; `sentAt` then says when it was
 * sent). Nothing is served until the caller publishes the answer (after reading what requests at
 * that head need). Rejects when the head cannot be read.
 */
export async function pollHead({ withFinalized }: { withFinalized: boolean }): Promise<PolledHead> {
  const flight = readHeads(withFinalized, !withFinalized);
  const { generation: readGeneration, read, sentAt } = flight;
  const ask = flight.asksFinalized;
  const { heads: polled, answeredAt } = await flight.answer;
  const head = polled.latest;
  const { finalized } = polled;
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
    sentAt,
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
 * The head requests read right now, when one is cached (or a read of it is in flight): never asks
 * the node. null otherwise.
 */
export function servedHead(): Promise<BlockRef> | null {
  return peek<Heads>(HEAD_KEY)?.then((read) => read.latest) ?? null;
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
  const readGeneration = generation;
  const times = await Promise.all(
    unique.map((n) =>
      cachedUntil(`block-ts:${net.chainId}:${n}`, async () => {
        const block = toBlockRef(
          await lanes().call.request("eth_getBlockByNumber", [numberToHex(n), false])
        );
        if (!block || block.number !== n) throw new Error(`The RPC returned no block ${n}`);
        const final = !net.isDevNode && n <= safe;
        if (readGeneration === generation) {
          checkSeededTimestamp(n, block.timestamp);
          if (final) noteFinalTimestamp(n, block.timestamp);
        }
        return { value: block.timestamp, ttlMs: final ? FOREVER : 0 };
      })
    )
  );
  return new Map(unique.map((n, i) => [n, times[i] as bigint]));
}

// Timestamps of final L1 blocks read under the current settings, for saving
// (persist/chain-cache.ts); at most FINAL_TIMESTAMPS_LIMIT of them.
const FINAL_TIMESTAMPS_LIMIT = 10_000;
let finalTimestamps: { generation: number; times: Map<bigint, bigint> } = {
  generation: -1,
  times: new Map(),
};

function currentFinalTimestamps(): Map<bigint, bigint> {
  if (finalTimestamps.generation !== generation) finalTimestamps = { generation, times: new Map() };
  return finalTimestamps.times;
}

function noteFinalTimestamp(n: bigint, timestamp: bigint) {
  const times = currentFinalTimestamps();
  if (times.has(n) || times.size < FINAL_TIMESTAMPS_LIMIT) times.set(n, timestamp);
}

/**
 * The final L1 block timestamps to save: those read under the current settings, and those the
 * last run read that nothing has contradicted (a contradiction discards them all, see
 * seededTimestamps).
 */
export function finalBlockTimestamps(): Map<bigint, bigint> {
  return new Map([...(currentSeededTimestamps()?.times ?? []), ...currentFinalTimestamps()]);
}

// Timestamps the last run read (seeded from disk): unverified, so only pages use them (labelled,
// see pageBlockTimestamps), until a read of the block confirms one. One that disagrees with the
// node calls `onMismatch`.
let seededTimestamps: {
  generation: number;
  times: Map<bigint, bigint>;
  onMismatch?: () => void;
} | null = null;

const currentSeededTimestamps = () =>
  seededTimestamps?.generation === generation ? seededTimestamps : null;

/** Seeds L1 block timestamps the last run read (see seededTimestamps). */
export function seedProvisionalTimestamps(
  times: ReadonlyMap<bigint, bigint>,
  onMismatch?: () => void
) {
  seededTimestamps = { generation, times: new Map(times), onMismatch };
}

/** Drops the seeded timestamps (the chain cache was found wrong, or is not used). */
export function dropProvisionalTimestamps() {
  seededTimestamps = null;
}

function checkSeededTimestamp(n: bigint, timestamp: bigint) {
  const seeded = currentSeededTimestamps();
  const known = seeded?.times.get(n);
  if (!seeded || known === undefined) return;
  seeded.times.delete(n);
  if (known !== timestamp) seeded.onMismatch?.();
}

/**
 * blockTimestamps for a page: a timestamp read in this run, else one the last run read (seeded,
 * unverified), else read now. `provisional`: one of the last run's was used.
 */
export async function pageBlockTimestamps(
  numbers: readonly bigint[]
): Promise<{ times: Map<bigint, bigint>; provisional: boolean }> {
  const known = currentFinalTimestamps();
  const seeded = currentSeededTimestamps();
  const times = new Map<bigint, bigint>();
  const missing: bigint[] = [];
  let provisional = false;
  for (const n of new Set(numbers)) {
    const time = known.get(n) ?? seeded?.times.get(n);
    if (time === undefined) missing.push(n);
    else {
      if (!known.has(n)) provisional = true;
      times.set(n, time);
    }
  }
  if (missing.length > 0) for (const [n, t] of await blockTimestamps(missing)) times.set(n, t);
  return { times, provisional };
}

/**
 * The chain the L1 RPC serves, named by its chain id and genesis block hash, read in one JSON-RPC
 * batch and kept for the settings generation. Names the chain cache's file.
 */
export function chainIdentity(): Promise<{ chainId: number; genesisHash: Hex }> {
  return cached(`chain-identity:${generation}`, FOREVER, async () => {
    const readGeneration = generation;
    const call = lanes().call;
    const [chainId, genesis] = await Promise.all([
      call.request<unknown>("eth_chainId", []),
      call.request<unknown>("eth_getBlockByNumber", ["0x0", false]),
    ]);
    const block = toBlockRef(genesis);
    if (!isHex(chainId) || !block || block.number !== 0n)
      throw new Error("The RPC returned no chain id or genesis block");
    const identity = {
      chainId: Number(hexToBigInt(chainId)),
      genesisHash: block.hash.toLowerCase() as Hex,
    };
    if (readGeneration === generation) knownIdentity = { generation, identity };
    return identity;
  });
}

let knownIdentity: { generation: number; identity: { chainId: number; genesisHash: Hex } } | null =
  null;

/** chainIdentity()'s answer once it has been read under the current settings; never reads. */
export function knownChainIdentity(): { chainId: number; genesisHash: Hex } | null {
  return knownIdentity?.generation === generation ? knownIdentity.identity : null;
}

/** ZKsync Era's chain id, from the L2 RPC (kept for the settings generation); null without one. */
export async function l2ChainId(): Promise<number | null> {
  const lane = await l2HeadLane();
  if (!lane) return null;
  return cached(`l2-chain-id:${generation}`, FOREVER, async () => {
    const readGeneration = generation;
    const id = await lane.request<unknown>("eth_chainId", []);
    if (!isHex(id)) throw new Error("The ZKsync Era RPC returned no chain id");
    const chainId = Number(hexToBigInt(id));
    if (readGeneration === generation) knownL2Id = { generation, chainId };
    return chainId;
  });
}

let knownL2Id: { generation: number; chainId: number } | null = null;

/** l2ChainId()'s answer once it has been read under the current settings (null: not yet); never reads. */
export function knownL2ChainId(): number | null {
  return knownL2Id?.generation === generation ? knownL2Id.chainId : null;
}

// Raw JSON-RPC lanes (chain/jsonrpc.ts). `history` carries eth_getLogs backfills, `call` the
// eth_call/eth_getCode verdict reads, `head` the 'latest'/'finalized' reads (requests' and the
// sync engine's polls). Each lane batches and adapts on its own, so a backfill never queues ahead
// of a page's reads, and a head read never shares a POST with (or waits on) a slow eth_call. They
// share one provider, though: while the call or head lane is under pressure (rate limited, or
// requests waiting for a POST slot), the history lane sends one POST at a time, so a backfill
// cannot take the provider's capacity from the reads a page waits on.
type L1Lanes = { history: Lane; call: Lane; head: Lane };
let l1Lanes: L1Lanes | undefined;
let generation = 0;

/** L1 lanes for the current data source settings. */
export function lanes(): L1Lanes {
  if (l1Lanes) return l1Lanes;
  // The call and head lanes ask a read again when the node failed to answer it (an internal
  // error): Infura answers reads pinned to a block it just named that way for up to about a
  // second, and one failed read fails a whole JSON answer.
  const call = createLane({
    url: env.L1_RPC_URL,
    label: "l1-call",
    maxBatch: 20,
    maxInFlight: 8,
    askAgain: true,
    onSend: countL1,
    pace: paceEngineRequest,
  });
  // One head read ('latest' with 'finalized') per POST. The sync engine paces its polls itself
  // (before it reads, so a request never joins a poll that is waiting its turn).
  const head = createLane({
    url: env.L1_RPC_URL,
    label: "l1-head",
    maxBatch: 2,
    maxInFlight: 4,
    askAgain: true,
    onSend: countL1,
  });
  const history = createLane({
    url: env.L1_RPC_URL,
    label: "l1-history",
    maxBatch: 25,
    maxInFlight: 8,
    onSend: countL1,
    pace: paceEngineRequest,
    yieldTo: () => call.busy() || head.busy(),
  });
  l1Lanes = { history, call, head };
  return l1Lanes;
}

// ---- ZKsync Era head ----

const L2_HEAD_KEY = "l2-latest-block";

/**
 * ZKsync Era's head and its finality boundary: `safe` is Era's 'finalized' block (one whose batch
 * was executed on L1), never above the head. -1 when the node does not know the tag: then nothing
 * is final, and the flows scan their windows on demand (as before the L2 log index) instead of
 * reading the index, whose tail would then be the governors' whole history at every Era head.
 */
export type L2Head = { head: BlockRef; safe: bigint; answeredAt: number };

// The newest 'finalized' Era block read under the current settings: a failed 'finalized' read
// falls back to it (finality only moves forward, so an older answer is a deeper boundary).
let knownL2Finalized: { generation: number; number: bigint } | null = null;

// Era head reads (requests' and the sync engine's), numbered in the order they were sent.
let l2HeadReads = 0;

// The newest Era head read under the current settings, by whoever read it. Era's RPC is load
// balanced and its backends can be a block or two apart: the sync engine's refresh never replaces
// the served Era head with an older one (as for L1, see newestHead).
let newestL2Head: NewestHead | null = null;

type L2HeadRead = { at: L2Head; read: number; readGeneration: number };

async function readL2Head(lane: Lane): Promise<L2HeadRead> {
  const readGeneration = generation;
  const read = ++l2HeadReads;
  // One JSON-RPC batch: both answers describe the same moment.
  const [latest, finalized] = await Promise.all([
    lane.request<unknown>("eth_getBlockByNumber", ["latest", false]),
    lane.request<unknown>("eth_getBlockByNumber", ["finalized", false]).then(
      (raw) => ({ block: toBlockRef(raw) }),
      (error: unknown) => ({ error })
    ),
  ]);
  const answeredAt = Date.now();
  const head = toBlockRef(latest);
  if (!head) throw new Error("The ZKsync Era RPC returned no latest block");
  let safe: bigint;
  if ("block" in finalized && finalized.block) {
    safe = finalized.block.number < head.number ? finalized.block.number : head.number;
    if (
      readGeneration === generation &&
      !(knownL2Finalized?.generation === generation && knownL2Finalized.number >= safe)
    )
      knownL2Finalized = { generation, number: safe };
  } else if (
    "error" in finalized &&
    finalized.error instanceof RpcError &&
    isUnknownTag(finalized.error)
  ) {
    safe = -1n;
  } else if (knownL2Finalized?.generation === readGeneration) {
    safe = knownL2Finalized.number < head.number ? knownL2Finalized.number : head.number;
  } else {
    throw "error" in finalized
      ? finalized.error
      : new Error("The ZKsync Era RPC returned no finalized block");
  }
  newestL2Head = withHead(newestL2Head, head, readGeneration, read);
  return { at: { head, safe, answeredAt }, read, readGeneration };
}

/**
 * ZKsync Era's head and 'finalized' block, read together and served for 4 s (as L1's head), or
 * null when no L2 RPC is configured. Rejects when the head cannot be read, or 'finalized' failed
 * and no finalized block is known yet (no boundary is ever assumed for a failure).
 */
export async function l2ChainHead(): Promise<L2Head | null> {
  const lane = await l2HeadLane();
  if (!lane) return null;
  return cached(L2_HEAD_KEY, HEAD_TTL_MS, async () => (await readL2Head(lane)).at);
}

/**
 * Reads Era's head now (the sync engine, ahead of requests) and serves it for 4 s from the node's
 * answer, unless the settings changed meanwhile or a newer Era head is known (a higher block, or
 * another block at this height named by a later read): then the head served stays. Resolves with
 * the node's answer either way; null without an L2 RPC.
 */
export async function refreshL2ChainHead(): Promise<L2Head | null> {
  const lane = await l2HeadLane();
  if (!lane) return null;
  const { at, read, readGeneration } = await readL2Head(lane);
  if (readGeneration === generation && supersedesHead(newestL2Head, at.head, read))
    replace(L2_HEAD_KEY, at, HEAD_TTL_MS - (Date.now() - at.answeredAt));
  return at;
}

// ZKsync Era lanes: `history` carries the governor index's eth_getLogs, `head` Era's
// 'latest'/'finalized' reads and the block headers windows are cut by, so a head read never
// queues behind a backfill's eth_getLogs chunks on an Era RPC that caps block ranges.
type L2Lanes = { history: Lane; head: Lane };
let l2Lanes: L2Lanes | null | undefined;

/** Era lanes for the current settings, or null when no L2 RPC is configured. */
async function l2LanesNow(): Promise<L2Lanes | null> {
  if (l2Lanes !== undefined) return l2Lanes;
  const started = generation;
  const { l2RpcUrl } = await network();
  // The settings changed while the network was read: answer for the new settings.
  if (started !== generation) return l2LanesNow();
  if (l2Lanes === undefined && l2RpcUrl) {
    const head = createLane({
      url: l2RpcUrl,
      label: "l2-head",
      maxBatch: 20,
      maxInFlight: 2,
      onSend: countL2,
    });
    const history = createLane({
      url: l2RpcUrl,
      label: "l2-history",
      maxBatch: 20,
      maxInFlight: 4,
      onSend: countL2,
      yieldTo: () => head.busy(),
    });
    l2Lanes = { history, head };
  }
  l2Lanes ??= null;
  return l2Lanes;
}

/** eth_getLogs lane for ZKsync Era, or null when no L2 RPC is configured. */
export async function l2HistoryLane(): Promise<Lane | null> {
  return (await l2LanesNow())?.history ?? null;
}

/** Era head and block header lane, or null when no L2 RPC is configured. */
export async function l2HeadLane(): Promise<Lane | null> {
  return (await l2LanesNow())?.head ?? null;
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
  knownL2Finalized = null;
  newestL2Head = null;
  tagUnsupported = null;
  newestHead = null;
  rereading = null;
  headInFlight = null;
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
  l2Lanes?.history.close();
  l2Lanes?.head.close();
  l2Lanes = undefined;
}
