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
import { FOREVER, cached, cachedUntil, concurrencyLimit, invalidate, peek, replace } from "./cache";
import { type Lane, RpcError, createLane } from "./chain/jsonrpc";
import { type LimitedHttpOptions, limitedHttp } from "./rpc-transport";
import { countUpstream } from "./sync/cost";
import { provideHeads } from "./sync/last-shown";
import { creditsOf, isEngineWork, paceAsEngine, paceEngineRequest } from "./sync/pacer";

// Public RPCs throttle bursts, so every client funnels requests through a small pool and backs
// off on 429 (viem retries rate-limit errors with exponential delay: 0.5, 1, 2, 4, 8 s).
// Multicall3 is deployed at the same address on mainnet, Sepolia and their forks. Reads made in the
// same tick go out as one aggregate3 eth_call, which keeps a page within public-RPC rate limits.
// None of the batched calls depend on msg.sender.
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Every request sent is counted for /api/status (sync.engine.cost), L1 ones by Infura credits.
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

// The engine's viem reads use clients of their own: a request never shares a Multicall3 call.
const engineOf = (options: LimitedHttpOptions, limit: ReturnType<typeof concurrencyLimit>) => ({
  ...options,
  limit,
  pace: paceAsEngine,
});

let l1Limit = concurrencyLimit(L1_TRANSPORT.maxInFlight);
let transport = limitedHttp(env.L1_RPC_URL, { ...L1_TRANSPORT, limit: l1Limit });
let engineTransport = limitedHttp(env.L1_RPC_URL, engineOf(L1_TRANSPORT, l1Limit));
let direct = createPublicClient({ transport });
let engineDirect = createPublicClient({ transport: engineTransport });
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
let engineBatched = makeBatched(engineTransport);
let useMulticall = false;

/** L1 client: batched through Multicall3 once the chain is known to have it. */
export const l1 = new Proxy({} as PublicClient, {
  get: (_, property) => {
    const engine = isEngineWork();
    const client = (useMulticall
      ? engine
        ? engineBatched
        : batched
      : engine
        ? engineDirect
        : direct) as unknown as Record<PropertyKey, unknown>;
    return client[property];
  },
});

// Own connections and no batching: a slow 'latest' read on `l1` never holds up a head's state read.
let stateLimit = concurrencyLimit(L1_STATE_TRANSPORT.maxInFlight);
let stateTransport = limitedHttp(env.L1_RPC_URL, { ...L1_STATE_TRANSPORT, limit: stateLimit });
let stateEngineTransport = limitedHttp(env.L1_RPC_URL, engineOf(L1_STATE_TRANSPORT, stateLimit));
let stateDirect = createPublicClient({ transport: stateTransport });
let stateBatched = makeBatched(stateTransport);
let stateEngineDirect = createPublicClient({ transport: stateEngineTransport });
let stateEngineBatched = makeBatched(stateEngineTransport);

export const l1State = new Proxy({} as PublicClient, {
  get: (_, property) => {
    const engine = isEngineWork();
    const client = (useMulticall
      ? engine
        ? stateEngineBatched
        : stateBatched
      : engine
        ? stateEngineDirect
        : stateDirect) as unknown as Record<PropertyKey, unknown>;
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

let settledNetwork: { generation: number; net: Network } | null = null;

/** network()'s answer under the current settings once it has answered, else null; never reads. */
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

export type BlockRef = { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint };

/** The node's 'finalized' answer: a block, an unknown tag (F = head − 64), or a failure. */
type FinalizedRead = { block: BlockRef } | { unsupported: true } | { error: unknown };
type Heads = { latest: BlockRef; finalized: FinalizedRead };

// Blocks this deep are treated as final even when the node's 'finalized' tag is further ahead.
const FINALITY_DEPTH = 64n;

// How a node says it does not know the 'finalized' tag: -32602 (geth before the merge), -32601,
// -39001, or that meaning in its text. -32603 and -32000 are failures, never "unsupported": a
// restarting node says "finalized block not found" and has one a moment later.
const UNSUPPORTED_TAG_CODES = new Set([-32602, -32601, -39001]);
const UNSUPPORTED_TAG =
  /(?:unknown|invalid|unsupported) block tag|block tag\b[^\n]{0,40}\b(?:not supported|unsupported|unknown|invalid)/i;

function isUnknownTag(error: RpcError) {
  if (error.code === -32603 || error.code === -32000) return false;
  return UNSUPPORTED_TAG_CODES.has(error.code) || UNSUPPORTED_TAG.test(error.message.slice(0, 500));
}

// The newest finalized block known: a failed 'finalized' read falls back to it (a deeper boundary).
let knownFinalized: { generation: number; block: BlockRef } | null = null;

function rememberFinalized(block: BlockRef, readGeneration: number) {
  if (readGeneration !== generation) return;
  if (knownFinalized?.generation === generation && knownFinalized.block.number >= block.number)
    return;
  knownFinalized = { generation, block };
}

let tagUnsupported: { generation: number } | null = null;

function finalizedRead(raw: unknown, readGeneration: number): FinalizedRead {
  const block = toBlockRef(raw);
  if (!block) return { error: new Error("The RPC returned no finalized block") };
  rememberFinalized(block, readGeneration);
  return { block };
}

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

const HEAD_TTL_MS = 4_000;
const HEAD_KEY = "latest-block";

let headReads = 0;

type NewestHead = { generation: number; block: BlockRef; read: number };

// Whether `block` (head read number `read`) may replace `known`: a higher block, the same block, or
// another block at that height named by a later read (the earlier one named a reorged orphan).
function supersedesHead(known: NewestHead | null, block: BlockRef, read: number): boolean {
  const current = known?.generation === generation ? known : null;
  if (!current) return true;
  if (block.number !== current.block.number) return block.number > current.block.number;
  return block.hash === current.block.hash || read > current.read;
}

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

// The newest head read under these settings. A poll never replaces the cached head with an older
// one: a lower block (a load-balanced RPC's backend behind), or a same-height block read earlier.
let newestHead: NewestHead | null = null;

function supersedes(block: BlockRef, read: number): boolean {
  return supersedesHead(newestHead, block, read);
}

function noteHead(block: BlockRef, readGeneration: number, read: number) {
  newestHead = withHead(newestHead, block, readGeneration, read);
}

type HeadRead = {
  generation: number;
  read: number;
  sentAt: number;
  asksFinalized: boolean;
  answer: Promise<{ heads: Heads; answeredAt: number }>;
};

// The head read in flight, shared by requests and the sync engine's poll: the node is asked once.
let headInFlight: HeadRead | null = null;

// Asks for the head, with 'finalized' in the same batch unless one is known and not asked for (the
// last real answer stands in, never newer than the boundary). Joins a read in flight that serves.
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

// The head and 'finalized' in one batch (the same moment). Only the head can fail this read: it
// never waits on or fails with the finality boundary.
function heads(): Promise<Heads> {
  const read = cached(HEAD_KEY, HEAD_TTL_MS, async () => {
    const flight = readHeads(true, true);
    const { heads: read } = await flight.answer;
    noteHead(read.latest, flight.generation, flight.read);
    return read;
  });
  trackHeads();
  return read;
}

const settledHeads = new WeakMap<Promise<Heads>, Heads>();
const trackedHeads = new WeakSet<Promise<Heads>>();

function trackHeads() {
  const stored = peek<Heads>(HEAD_KEY);
  if (!stored || trackedHeads.has(stored)) return;
  trackedHeads.add(stored);
  stored.then(
    (read) => {
      settledHeads.set(stored, read);
    },
    () => {}
  );
}

/** The head requests read now, when it is in memory; else null (never waits, never asks). */
export function servedHeadNow(): BlockRef | null {
  const stored = peek<Heads>(HEAD_KEY);
  return stored ? settledHeads.get(stored)?.latest ?? null : null;
}

export type PolledHead = {
  head: BlockRef;
  /** 'finalized' when this poll asked: a block, null for an unknown tag; else undefined. */
  finalized: BlockRef | null | undefined;
  generation: number;
  answeredAt: number;
  sentAt?: number;
  boundary(): Promise<bigint>;
  isNewest(): boolean;
  /** Serves this head until 4 s after the node named it; false when stale or superseded. */
  publish(): boolean;
  /** Serves this head 4 s more without asking, when no newer block can exist yet; else false. */
  confirm(): boolean;
};

function publishHeads(heads: Heads, readGeneration: number, read: number, ttlMs: number): boolean {
  if (readGeneration !== generation || ttlMs <= 0 || !supersedes(heads.latest, read)) return false;
  noteHead(heads.latest, readGeneration, read);
  replace(HEAD_KEY, heads, ttlMs);
  const stored = peek<Heads>(HEAD_KEY);
  if (stored) {
    trackedHeads.add(stored);
    settledHeads.set(stored, heads);
  }
  return true;
}

/** The sync engine's head read (see readHeads): nothing is served until the caller publishes it. */
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
    // 4 s from the node's answer, as a request's own read: never longer for a later publish.
    publish: () =>
      publishHeads(polled, readGeneration, read, HEAD_TTL_MS - (Date.now() - answeredAt)),
    confirm: () => {
      if (readGeneration !== generation) return false;
      const known = newest();
      if (known && known.hash !== head.hash) return false;
      return publishHeads(polled, readGeneration, read, HEAD_TTL_MS);
    },
  };
}

// One fresh 'finalized' read at a time, after a failed read with nothing known to fall back to.
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

// The finalized block for the boundary: this read's, else the newest known, else one fresh read;
// null for an unknown tag. Rejects without a real answer: head − 64 is never assumed for a failure.
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

/** The head requests read now, when cached or in flight (never asks the node); else null. */
export function servedHead(): Promise<BlockRef> | null {
  return peek<Heads>(HEAD_KEY)?.then((read) => read.latest) ?? null;
}

export async function finalizedBlock(): Promise<BlockRef | null> {
  return finalizedFor((await heads()).finalized);
}

/**
 * The head and the finality boundary F = min(head − 64, finalized): head − 64 for an unknown tag,
 * the fork block on dev nodes. Rejects when 'finalized' failed and no finalized block is known.
 */
export async function chainHead(): Promise<{ head: BlockRef; safe: bigint }> {
  const [net, read] = await Promise.all([network(), heads()]);
  return { head: read.latest, safe: await boundaryOf(net, read) };
}

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

export function refreshHead() {
  invalidate(HEAD_KEY);
}

/** L1 block timestamps, in one batch; a final block's is kept for good (not on dev nodes). */
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

/** Final L1 timestamps to save: this run's, and the last run's that nothing contradicted. */
export function finalBlockTimestamps(): Map<bigint, bigint> {
  return new Map([...(currentSeededTimestamps()?.times ?? []), ...currentFinalTimestamps()]);
}

// Timestamps the last run read: unverified, so only pages use them (labelled) until a read of the
// block confirms one. One that disagrees with the node calls `onMismatch`.
let seededTimestamps: {
  generation: number;
  times: Map<bigint, bigint>;
  onMismatch?: () => void;
} | null = null;

const currentSeededTimestamps = () =>
  seededTimestamps?.generation === generation ? seededTimestamps : null;

export function seedProvisionalTimestamps(
  times: ReadonlyMap<bigint, bigint>,
  onMismatch?: () => void
) {
  seededTimestamps = { generation, times: new Map(times), onMismatch };
}

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

/** blockTimestamps for pages: the last run's may stand in (`provisional` then says so). */
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

// Raw JSON-RPC lanes (chain/jsonrpc.ts). While `call` or `head` is busy, `history` sends one POST
// at a time, so a backfill never takes the provider's capacity from a page's reads.
type L1Lanes = { history: Lane; call: Lane; head: Lane };
let l1Lanes: L1Lanes | undefined;
let generation = 0;

export function lanes(): L1Lanes {
  if (l1Lanes) return l1Lanes;
  // askAgain: Infura answers a read pinned to a block it just named "Internal error" for up to
  // about a second, and one failed read fails a whole JSON answer.
  const call = createLane({
    url: env.L1_RPC_URL,
    label: "l1-call",
    maxBatch: 20,
    maxInFlight: 8,
    askAgain: true,
    onSend: countL1,
    pace: paceEngineRequest,
  });
  // One head read ('latest' with 'finalized') per POST; the engine paces its polls itself.
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

const L2_HEAD_KEY = "l2-latest-block";

/** Era's head; `safe`: Era's 'finalized' block (at most the head), -1 for an unknown tag. */
export type L2Head = { head: BlockRef; safe: bigint; answeredAt: number };

// The newest Era 'finalized' block read under these settings: a failed read falls back to it.
let knownL2Finalized: { generation: number; number: bigint } | null = null;

let l2HeadReads = 0;

// Era's RPC is load balanced (backends a block or two apart): a refresh never replaces the served
// Era head with an older one (see newestHead).
let newestL2Head: NewestHead | null = null;

type L2HeadRead = { at: L2Head; read: number; readGeneration: number };

let lastL2Read: { at: L2Head; generation: number } | null = null;

async function readL2Head(lane: Lane, withFinalized = true): Promise<L2HeadRead> {
  const readGeneration = generation;
  const read = ++l2HeadReads;
  // 'finalized' is skipped only when one is known (finality only moves forward).
  const askFinalized = withFinalized || knownL2Finalized?.generation !== readGeneration;
  // One JSON-RPC batch: both answers describe the same moment.
  const [latest, finalized] = await Promise.all([
    lane.request<unknown>("eth_getBlockByNumber", ["latest", false]),
    askFinalized
      ? lane.request<unknown>("eth_getBlockByNumber", ["finalized", false]).then(
          (raw) => ({ block: toBlockRef(raw) }),
          (error: unknown) => ({ error })
        )
      : Promise.resolve({ skipped: true as const }),
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
  const at = { head, safe, answeredAt };
  if (
    readGeneration === generation &&
    !(lastL2Read?.generation === generation && lastL2Read.at.head.number > head.number)
  )
    lastL2Read = { at, generation };
  return { at, read, readGeneration };
}

/** Era's head and 'finalized' (4 s); rejects when 'finalized' failed with none known yet. */
export async function l2ChainHead(): Promise<L2Head | null> {
  const lane = await l2HeadLane();
  if (!lane) return null;
  return cached(L2_HEAD_KEY, HEAD_TTL_MS, async () => (await readL2Head(lane)).at);
}

/** The sync engine's Era head read: served unless the settings changed or a newer head is known. */
export async function refreshL2ChainHead({
  withFinalized = true,
}: { withFinalized?: boolean } = {}): Promise<L2Head | null> {
  const lane = await l2HeadLane();
  if (!lane) return null;
  const { at, read, readGeneration } = await readL2Head(lane, withFinalized);
  if (readGeneration === generation && supersedesHead(newestL2Head, at.head, read))
    replace(L2_HEAD_KEY, at, HEAD_TTL_MS - (Date.now() - at.answeredAt));
  return at;
}

/** Pages only (never JSON): the newest Era head if at most `maxAgeMs` old, else l2ChainHead(). */
export async function pageL2ChainHead(maxAgeMs: number): Promise<L2Head | null> {
  const known = lastL2Read;
  if (known && known.generation === generation && Date.now() - known.at.answeredAt <= maxAgeMs)
    return known.at;
  return l2ChainHead();
}

export function lastL2Head(): L2Head | null {
  return lastL2Read?.generation === generation ? lastL2Read.at : null;
}

// Era lanes: `history` for the governor index's eth_getLogs, `head` for heads and block headers,
// so a head read never queues behind a backfill on an Era RPC that caps block ranges.
type L2Lanes = { history: Lane; head: Lane };
let l2Lanes: L2Lanes | null | undefined;

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

export async function l2HistoryLane(): Promise<Lane | null> {
  return (await l2LanesNow())?.history ?? null;
}

export async function l2HeadLane(): Promise<Lane | null> {
  return (await l2LanesNow())?.head ?? null;
}

/** The eth_getLogs lane behind `l1` or the client `l2()` made; null for any other client. */
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
  lastL2Read = null;
  tagUnsupported = null;
  newestHead = null;
  rereading = null;
  headInFlight = null;
  l1Limit = concurrencyLimit(L1_TRANSPORT.maxInFlight);
  transport = limitedHttp(env.L1_RPC_URL, { ...L1_TRANSPORT, limit: l1Limit });
  engineTransport = limitedHttp(env.L1_RPC_URL, engineOf(L1_TRANSPORT, l1Limit));
  direct = createPublicClient({ transport });
  engineDirect = createPublicClient({ transport: engineTransport });
  batched = makeBatched(transport);
  engineBatched = makeBatched(engineTransport);
  stateLimit = concurrencyLimit(L1_STATE_TRANSPORT.maxInFlight);
  stateTransport = limitedHttp(env.L1_RPC_URL, { ...L1_STATE_TRANSPORT, limit: stateLimit });
  stateEngineTransport = limitedHttp(env.L1_RPC_URL, engineOf(L1_STATE_TRANSPORT, stateLimit));
  stateDirect = createPublicClient({ transport: stateTransport });
  stateBatched = makeBatched(stateTransport);
  stateEngineDirect = createPublicClient({ transport: stateEngineTransport });
  stateEngineBatched = makeBatched(stateEngineTransport);
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

// Page loaders read the head through these before their reads start (sync/last-shown.ts).
provideHeads({
  servedHeadNow,
  latestBlock,
  generation: rpcGeneration,
  isDevNode: () => resolvedNetwork()?.isDevNode ?? null,
});
