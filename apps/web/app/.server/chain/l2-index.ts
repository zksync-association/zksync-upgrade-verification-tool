import { l2GovernorAbi } from "@/common/abis";
import { knownNetwork } from "@/common/networks";
import { env } from "@config/env.server";
import {
  type Address,
  type Hex,
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  hexToBigInt,
  isAddressEqual,
  isHex,
} from "viem";
import { FOREVER, cached } from "../cache";
import {
  type L2Head,
  type Network,
  l2ChainHead,
  l2HeadLane,
  l2HistoryLane,
  network,
  pageL2ChainHead,
  rpcGeneration,
} from "../rpc";
import { scrubText, secretsOf } from "./jsonrpc";
import {
  type FinalSnapshot,
  IndexClosed,
  type IndexStatus,
  type IndexedLog,
  type LogIndex,
  type ProvisionalOutcome,
  type ProvisionalSeed,
  SeedExpectation,
  createLogIndex,
} from "./log-index";

// The ZKsync Era governors' log index: their ProposalCreated, ProposalExecuted and ProposalCanceled
// logs from the first one to the Era head, kept for the settings generation (one eth_getLogs holds
// mainnet's ~80; each Era head re-reads only the blocks above Era's 'finalized'). Only these three
// events: the governors also emit a VoteCast per vote, more than an eth_getLogs answer may hold.

type L2GovernorEventName = "ProposalCreated" | "ProposalExecuted" | "ProposalCanceled";

const L2_GOVERNOR_EVENTS: readonly L2GovernorEventName[] = [
  "ProposalCreated",
  "ProposalExecuted",
  "ProposalCanceled",
];

const TOPICS = new Map<string, L2GovernorEventName>(
  L2_GOVERNOR_EVENTS.map((name) => [
    (encodeEventTopics({ abi: l2GovernorAbi, eventName: name })[0] as Hex).toLowerCase(),
    name,
  ])
);

const LABEL = "L2 governors";

export const L2_GOVERNOR_TOPICS: readonly Hex[] = [...TOPICS.keys()] as Hex[];

export type L2GovernorEvent = {
  eventName: L2GovernorEventName;
  governor: Address;
  proposalId: bigint;
  log: IndexedLog;
  /** From the final range (at or below Era's 'finalized' block when answered): never changes. */
  final: boolean;
  /** From the history the last run read, not read again yet (pages only): never kept. */
  provisional: boolean;
};

/** The Era head the answer is complete at; `provisional`: partly from the last run's history. */
type L2GovernorRead = { head: L2Head; events: L2GovernorEvent[]; provisional: boolean };

type L2Seed = ProvisionalSeed & {
  chainId: number;
  l2ChainId: number;
  addresses: Address[];
  fromBlock: bigint;
};

type L2Snapshot = FinalSnapshot & { chainId: number; addresses: Address[] };

export type L2IndexStatus = Omit<IndexStatus, "deployBlock"> & {
  deployBlock: string | null;
  governors: Address[];
};

const IDLE: L2IndexStatus = {
  state: "idle",
  deployBlock: null,
  coveredFrom: null,
  finalizedTo: null,
  headTo: null,
  chunks: { done: 0, total: 0 },
  strategy: null,
  span: null,
  logs: 0,
  error: null,
  provisional: null,
  governors: [],
};

type GovernorNetwork = Pick<Network, "chainId" | "l2RpcUrl" | "l2Governors">;

/** The pinned governors in use under `net` (an override keeps the on-demand path), or null. */
export function indexedL2Governors(
  net: GovernorNetwork
): { addresses: Address[]; fromBlock: bigint } | null {
  const pinned = knownNetwork(net.chainId);
  if (!pinned || !net.l2RpcUrl) return null;
  const fromBlock = pinned.l2GovernorsFirstLogBlock ?? pinned.l2GovernorsDeployBlock;
  if (fromBlock === null) return null;
  const addresses: Address[] = [];
  for (const kind of ["token", "govOps", "protocol"] as const) {
    const pin = pinned.l2Governors[kind];
    const used = net.l2Governors[kind];
    if (pin && used && isAddressEqual(pin, used)) addresses.push(getAddress(pin));
  }
  return addresses.length > 0 ? { addresses, fromBlock } : null;
}

export function isIndexedL2Governor(net: GovernorNetwork, governor: Address | null): boolean {
  if (!governor) return false;
  return !!indexedL2Governors(net)?.addresses.some((a) => isAddressEqual(a, governor));
}

/**
 * The Era head the index answers at; null when no governor is indexed or Era does not know the
 * 'finalized' tag (nothing is final: callers scan on demand). Rejects when Era's head fails.
 */
export async function l2IndexHead(
  net: GovernorNetwork,
  { page = false }: { page?: boolean } = {}
): Promise<L2Head | null> {
  if (!indexedL2Governors(net)) return null;
  // Pages only (never JSON): the newest Era head at most ERA_PAGE_MAX_AGE_MS old.
  const at = page ? await pageL2ChainHead(ERA_PAGE_MAX_AGE_MS) : await l2ChainHead();
  return at && at.safe >= 0n ? at : null;
}

/** The Era timer's minute (sync/era.ts) plus a margin. JSON keeps Era's head at most 4 s old. */
export const ERA_PAGE_MAX_AGE_MS = 75_000;

/** One line of error text with every part of the configured RPC URLs removed. */
function describe(error: unknown, l2Url: string | null = null): string {
  const raw =
    error instanceof Error
      ? (error as { shortMessage?: string }).shortMessage || error.message
      : String(error);
  const secrets = [env.L1_RPC_URL, env.L2_RPC_URL, l2Url].flatMap((url) =>
    url ? secretsOf(url) : []
  );
  return scrubText(raw.split("\n")[0] ?? raw, secrets);
}

const keyOf = (chainId: number, fromBlock: bigint, addresses: readonly Address[]) =>
  [chainId, fromBlock, ...addresses.map((a) => a.toLowerCase())].join(":");

type Built = {
  key: string;
  chainId: number;
  addresses: Address[];
  index: LogIndex;
  /** Decoded events per log (block hash and log index name one log for good). */
  decoded: Map<string, { eventName: L2GovernorEventName; governor: Address; proposalId: bigint }>;
};

class L2GovernorIndex {
  #built: Built | undefined;
  #error: string | null = null;
  #closed = false;
  // A history from the last run, until the index it is for is built (then handed to it).
  #seed: { seed: L2Seed; onOutcome?: (outcome: ProvisionalOutcome) => void } | null = null;
  #seedComing = new SeedExpectation();

  constructor(readonly generation: number) {}

  #current = () => !this.#closed && rpcGeneration() === this.generation;

  async #index(): Promise<Built | null> {
    if (!this.#current()) throw new IndexClosed(LABEL);
    let net: Network;
    try {
      net = await network();
    } catch (error) {
      this.#error = describe(error);
      throw error;
    }
    const covered = indexedL2Governors(net);
    if (!covered) return null;
    const lane = await l2HistoryLane();
    if (!this.#current()) throw new IndexClosed(LABEL);
    if (!lane) return null;
    const key = keyOf(net.chainId, covered.fromBlock, covered.addresses);
    if (this.#built?.key !== key) {
      this.#built?.index.close();
      const l2Url = net.l2RpcUrl;
      this.#built = {
        key,
        chainId: net.chainId,
        addresses: covered.addresses,
        decoded: new Map(),
        index: createLogIndex({
          label: LABEL,
          lane,
          address: covered.addresses,
          topic0: [...TOPICS.keys()] as Hex[],
          deployBlock: covered.fromBlock,
          head: async () => {
            const read = await l2ChainHead();
            if (!read) throw new Error("No ZKsync Era RPC is configured");
            return { head: read.head, safe: read.safe };
          },
          isCurrent: this.#current,
          describeError: (error) => describe(error, l2Url),
        }),
      };
      this.#applySeed();
    }
    this.#error = null;
    return this.#built;
  }

  #applySeed() {
    const pending = this.#seed;
    const built = this.#built;
    if (!pending || !built) return;
    this.#seed = null;
    const { seed, onOutcome } = pending;
    const accepted =
      built.key === keyOf(seed.chainId, seed.fromBlock, seed.addresses) &&
      built.index.seedProvisional(seed, onOutcome);
    if (!accepted) onOutcome?.("dropped");
  }

  /** Seeds the last run's history for the governors it names (the caller checked the Era chain). */
  seedProvisional(seed: L2Seed, onOutcome?: (outcome: ProvisionalOutcome) => void) {
    if (!this.#current() || this.#seed) {
      onOutcome?.("dropped");
      return;
    }
    this.#seed = { seed, onOutcome };
    this.#applySeed();
  }

  expectSeed(until: Promise<unknown>) {
    this.#seedComing.expect(until);
  }

  dropProvisional() {
    this.#seed = null;
    this.#built?.index.dropProvisional();
  }

  snapshot(): L2Snapshot | null {
    const built = this.#built;
    if (!built || !this.#current()) return null;
    const final = built.index.finalSnapshot();
    return final && { ...final, chainId: built.chainId, addresses: [...built.addresses] };
  }

  async startBackfill(): Promise<void> {
    try {
      await (await this.#index())?.index.startBackfill();
    } catch {
      // Reported through status().
    }
  }

  status(): L2IndexStatus {
    if (this.#built) return { ...this.#built.index.status(), governors: this.#built.addresses };
    return this.#error ? { ...IDLE, state: "unavailable", error: this.#error } : { ...IDLE };
  }

  /** Every indexed event up to the Era head (`head`, or the one served now), complete, in order. */
  async read({
    head,
    waitMs,
    provisional,
  }: { head?: L2Head; waitMs?: number; provisional?: boolean } = {}): Promise<L2GovernorRead> {
    if (provisional) await this.#seedComing.wait();
    const built = await this.#index();
    if (!built) throw new Error("No ZKsync Era governor is indexed under the current settings");
    const at = head ?? (await l2ChainHead());
    if (!at) throw new Error("No ZKsync Era RPC is configured");
    if (!this.#current()) throw new IndexClosed(LABEL);
    const { logs, finalTo, provisionalTo } = await built.index.read({
      head: { head: at.head, safe: at.safe },
      waitMs,
      provisional,
    });
    const events: L2GovernorEvent[] = [];
    try {
      for (const log of logs) {
        const fromLastRun = provisionalTo !== null && log.blockNumber <= provisionalTo;
        const key = `${log.blockHash.toLowerCase()}:${log.logIndex}`;
        // A log from the last run's history is decoded for this answer only: what it says is
        // never kept for this run's log at the same place.
        let decoded = fromLastRun ? undefined : built.decoded.get(key);
        if (!decoded) {
          const eventName = TOPICS.get(String(log.topics[0]).toLowerCase());
          if (!eventName) continue;
          const { args } = decodeEventLog({
            abi: l2GovernorAbi,
            eventName,
            topics: log.topics,
            data: log.data,
          });
          decoded = { eventName, governor: getAddress(log.address), proposalId: args.proposalId };
          if (!fromLastRun) built.decoded.set(key, decoded);
        }
        events.push({
          ...decoded,
          log,
          final: !fromLastRun && log.blockNumber <= finalTo,
          provisional: fromLastRun,
        });
      }
    } catch (error) {
      // What the last run's history holds never fails a page: this run's history answers.
      if (provisionalTo === null) throw error;
      return this.read({ head: at, waitMs, provisional: false });
    }
    return { head: at, events, provisional: provisionalTo !== null };
  }

  close() {
    this.#closed = true;
    this.#built?.index.close();
    this.#built = undefined;
    const pending = this.#seed;
    this.#seed = null;
    pending?.onOutcome?.("dropped");
  }
}

let instance: L2GovernorIndex | undefined;

/** The L2 governor index for the current data source settings. A settings change discards it. */
export function l2GovernorIndex(): L2GovernorIndex {
  const generation = rpcGeneration();
  if (instance?.generation !== generation) {
    instance?.close();
    instance = new L2GovernorIndex(generation);
  }
  return instance;
}

// Headers per JSON-RPC batch when looking for a window's first block (Era allows 100).
const TIMESTAMP_BATCH = 20;
const FINAL_TIMES_LIMIT = 10_000;

export type L2BlockTime = { hash: Hex; number: bigint; timestamp: bigint };

let finalTimes: { generation: number; times: Map<string, L2BlockTime> } = {
  generation: -1,
  times: new Map(),
};

// Timestamps the last run read (seeded from disk): unverified, so only pages use them (labelled),
// until a read of the block confirms one. One that disagrees with the node calls `onMismatch`.
let seededTimes: {
  generation: number;
  times: Map<string, L2BlockTime>;
  onMismatch?: () => void;
} | null = null;

function currentFinalTimes(): Map<string, L2BlockTime> {
  const generation = rpcGeneration();
  if (finalTimes.generation !== generation) finalTimes = { generation, times: new Map() };
  return finalTimes.times;
}

function currentSeededTimes() {
  return seededTimes?.generation === rpcGeneration() ? seededTimes : null;
}

export function seedProvisionalL2Times(times: readonly L2BlockTime[], onMismatch?: () => void) {
  seededTimes = {
    generation: rpcGeneration(),
    times: new Map(times.map((t) => [t.hash.toLowerCase(), t])),
    onMismatch,
  };
}

export function dropProvisionalL2Times() {
  seededTimes = null;
}

/** Final Era timestamps to save: this run's, and the last run's that nothing contradicted. */
export function finalL2BlockTimes(): L2BlockTime[] {
  const times = new Map(currentSeededTimes()?.times ?? []);
  for (const [hash, time] of currentFinalTimes()) times.set(hash, time);
  return [...times.values()];
}

function checkSeeded(hash: Hex, timestamp: bigint) {
  const seeded = currentSeededTimes();
  const known = seeded?.times.get(hash.toLowerCase());
  if (!seeded || !known) return;
  seeded.times.delete(hash.toLowerCase());
  if (known.timestamp !== timestamp) seeded.onMismatch?.();
}

/** An Era block's timestamp by hash: a hash names one header, so it is kept for good. */
function l2BlockTime(hash: Hex): Promise<bigint> {
  return cached(`l2-block-ts:${hash.toLowerCase()}`, FOREVER, async () => {
    const lane = await l2HeadLane();
    if (!lane) throw new Error("No ZKsync Era RPC is configured");
    const raw = await lane.request<unknown>("eth_getBlockByHash", [hash, false]);
    const { hash: answered, timestamp } = (raw ?? {}) as { hash?: unknown; timestamp?: unknown };
    if (!isHex(answered) || answered.toLowerCase() !== hash.toLowerCase() || !isHex(timestamp))
      throw new Error(`The ZKsync Era RPC returned no block ${hash}`);
    const value = hexToBigInt(timestamp);
    checkSeeded(hash, value);
    return value;
  });
}

/**
 * The events in blocks with a timestamp in [since, until]. Era timestamps never decrease, so
 * headers are read newest first, 20 per batch, until one is older than `since`.
 */
export async function eventsInWindow<E extends { log: IndexedLog; final?: boolean }>(
  events: readonly E[],
  since: bigint,
  until?: bigint
): Promise<E[]> {
  return (await windowOf(events, since, until, false)).events;
}

/** eventsInWindow for pages: the last run's timestamps may stand in (`provisional` says so). */
export function eventsInWindowAnswer<E extends { log: IndexedLog; final?: boolean }>(
  events: readonly E[],
  since: bigint,
  until?: bigint
): Promise<{ events: E[]; provisional: boolean }> {
  return windowOf(events, since, until, true);
}

async function windowOf<E extends { log: IndexedLog; final?: boolean }>(
  events: readonly E[],
  since: bigint,
  until: bigint | undefined,
  allowSeeded: boolean
): Promise<{ events: E[]; provisional: boolean }> {
  const blocks = new Map<bigint, { hash: Hex; final: boolean }>();
  for (const { log, final } of events)
    blocks.set(log.blockNumber, {
      hash: log.blockHash,
      final: (blocks.get(log.blockNumber)?.final ?? false) || final === true,
    });
  const newestFirst = [...blocks].sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0));
  const kept = new Set<bigint>();
  const known = currentFinalTimes();
  let provisional = false;
  const timeOf = (hash: Hex): Promise<bigint> => {
    if (allowSeeded) {
      const verified = known.get(hash.toLowerCase());
      if (verified) return Promise.resolve(verified.timestamp);
      const seeded = currentSeededTimes()?.times.get(hash.toLowerCase());
      if (seeded) {
        provisional = true;
        return Promise.resolve(seeded.timestamp);
      }
    }
    return l2BlockTime(hash);
  };
  for (let i = 0; i < newestFirst.length; i += TIMESTAMP_BATCH) {
    const batch = newestFirst.slice(i, i + TIMESTAMP_BATCH);
    const times = await Promise.all(batch.map(([, { hash }]) => timeOf(hash)));
    let older = false;
    batch.forEach(([number, { hash, final }], j) => {
      const time = times[j] as bigint;
      // A final block's timestamp read in this run (not a seeded one): kept for saving.
      if (final && !known.has(hash.toLowerCase()) && known.size < FINAL_TIMES_LIMIT) {
        const seeded = allowSeeded && currentSeededTimes()?.times.has(hash.toLowerCase());
        if (!seeded) known.set(hash.toLowerCase(), { hash, number, timestamp: time });
      }
      if (time < since) older = true;
      else if (!older && (until === undefined || time <= until)) kept.add(number);
    });
    if (older) break;
  }
  return { events: events.filter(({ log }) => kept.has(log.blockNumber)), provisional };
}
