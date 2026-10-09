import { upgradeHandlerAbi } from "@/common/abis";
import { env } from "@config/env.server";
import {
  type Address,
  type ContractEventName,
  type DecodeEventLogReturnType,
  type Hex,
  decodeEventLog,
  encodeEventTopics,
  isAddressEqual,
} from "viem";
import { seedLogSpan } from "../logs";
import { type Network, chainHead, lanes, network, rpcGeneration } from "../rpc";
import { scrubText, secretsOf } from "./jsonrpc";
import {
  type FinalSnapshot,
  IndexClosed,
  type IndexHead,
  type IndexRead,
  type IndexStatus,
  type IndexedLog,
  type LogIndex,
  type LogQuery,
  type ProvisionalOutcome,
  type ProvisionalSeed,
  SeedExpectation,
  createLogIndex,
} from "./log-index";

// The ProtocolUpgradeHandler's log index: every log the handler (and its proxy) has emitted since
// upgradeHandlerDeployBlock, read once and kept for the settings generation. Mainnet holds about a
// hundred logs, so lists and per-id lookups filter memory instead of scanning the chain.

export type PuhEventName = ContractEventName<typeof upgradeHandlerAbi>;

export type PuhEvent<N extends PuhEventName = PuhEventName> = {
  args: DecodeEventLogReturnType<typeof upgradeHandlerAbi, N>["args"];
  log: IndexedLog;
  /** From the final range at answer time: never changes. False for tail and last-run events. */
  final: boolean;
  /** From the last run's history, not read again yet (pages only). Never kept. */
  provisional: boolean;
};

/** `provisional`: part of the range was answered from the last run's history. */
type PuhEventsAnswer<N extends PuhEventName> = {
  events: PuhEvent<N>[];
  provisional: boolean;
};

/** Which handler a seeded history is for (the index answers only for the same chain and handler). */
type PuhSeed = ProvisionalSeed & { chainId: number; address: Address; deployBlock: bigint };

type PuhSnapshot = FinalSnapshot & { chainId: number; address: Address };

export type PuhIndexStatus = Omit<IndexStatus, "deployBlock"> & { deployBlock: string | null };

/** The index contradicts itself or the contract (e.g. two execution events for one id). */
export class IndexIntegrityError extends Error {
  override name = "IndexIntegrityError";
}

const IDLE: PuhIndexStatus = {
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
};

/** One line of error text with every part of the configured RPC URLs removed. */
function describe(error: unknown): string {
  const raw =
    error instanceof Error
      ? (error as { shortMessage?: string }).shortMessage || error.message
      : String(error);
  const secrets = [env.L1_RPC_URL, env.L2_RPC_URL].flatMap((url) => (url ? secretsOf(url) : []));
  return scrubText(raw.split("\n")[0] ?? raw, secrets);
}

const topics = new Map<string, Hex>();
function topicOf(name: PuhEventName): Hex {
  let topic = topics.get(name);
  if (!topic) {
    topic = (
      encodeEventTopics({ abi: upgradeHandlerAbi, eventName: name })[0] as Hex
    ).toLowerCase() as Hex;
    topics.set(name, topic);
  }
  return topic;
}

type Built = { key: string; net: Network; index: LogIndex };

const liveKey = (chainId: number, address: Address, deployBlock: bigint) =>
  [chainId, address.toLowerCase(), deployBlock, "live"].join(":");

type PendingSeed = {
  seed: PuhSeed;
  onOutcome?: (outcome: ProvisionalOutcome) => void;
};

export class PuhIndex {
  #built: Built | undefined;
  #error: string | null = null;
  #closed = false;
  // A history from the last run, until the index it is for is built (then handed to it).
  #seed: PendingSeed | null = null;
  #seedComing = new SeedExpectation();

  constructor(readonly generation: number) {}

  #current = () => !this.#closed && rpcGeneration() === this.generation;

  async #index(): Promise<Built> {
    if (!this.#current()) throw new IndexClosed("ProtocolUpgradeHandler");
    let net: Network;
    try {
      net = await network();
    } catch (error) {
      this.#error = describe(error);
      throw error;
    }
    if (!this.#current()) throw new IndexClosed("ProtocolUpgradeHandler");
    // On a dev node the finality boundary is the fork block: a node restarted at another fork
    // block (seen after the refresh route clears the network) gets a fresh index.
    const key = [
      net.chainId,
      net.upgradeHandler.toLowerCase(),
      net.upgradeHandlerDeployBlock,
      net.isDevNode ? `dev@${net.forkBlock ?? "none"}` : "live",
    ].join(":");
    if (this.#built?.key !== key) {
      this.#built?.index.close();
      const { history, call } = lanes();
      this.#built = {
        key,
        net,
        index: createLogIndex({
          label: "ProtocolUpgradeHandler",
          lane: history,
          // The tail a page or the sync engine waits on never queues behind backfill chunks.
          quickLane: call,
          address: net.upgradeHandler,
          deployBlock: net.upgradeHandlerDeployBlock,
          head: chainHead,
          isCurrent: this.#current,
          describeError: describe,
          // Other scans on the same lane (logs.ts fallbacks) start at the provider's cap.
          onCap: (cap) => seedLogSpan(history, cap),
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
      built.key === liveKey(seed.chainId, seed.address, seed.deployBlock) &&
      built.index.seedProvisional(seed, onOutcome);
    if (!accepted) onOutcome?.("dropped");
  }

  /** Seeds the last run's history; an index for another chain or handler drops it ("dropped"). */
  seedProvisional(seed: PuhSeed, onOutcome?: (outcome: ProvisionalOutcome) => void) {
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

  /** A last-run history is seeded and unverified, or the chain cache that may hold one loads. */
  hasLastRunHistory(): boolean {
    if (!this.#current()) return false;
    if (this.#seed || this.#seedComing.pending) return true;
    return this.#built?.index.status().provisional?.state === "provisional";
  }

  dropProvisional() {
    this.#seed = null;
    this.#built?.index.dropProvisional();
  }

  /** The complete final history of the handler in use (live chains only), or null. */
  snapshot(): PuhSnapshot | null {
    const built = this.#built;
    if (!built || !this.#current() || built.net.isDevNode) return null;
    const final = built.index.finalSnapshot();
    return final && { ...final, chainId: built.net.chainId, address: built.net.upgradeHandler };
  }

  async startBackfill(): Promise<void> {
    try {
      await (await this.#index()).index.startBackfill();
    } catch {
      // Reported through status().
    }
  }

  async syncHead(head?: IndexHead): Promise<void> {
    await (await this.#index()).index.syncHead(head);
  }

  status(): PuhIndexStatus {
    if (this.#built) return this.#built.index.status();
    return this.#error ? { ...IDLE, state: "unavailable", error: this.#error } : { ...IDLE };
  }

  async logs(query?: LogQuery): Promise<IndexedLog[]> {
    return (await this.#index()).index.logs(query);
  }

  /** Decoded `name` events, optionally for one id (topic 1), oldest first. */
  async events<N extends PuhEventName>(
    name: N,
    query: LogQuery & { id?: Hex } = {}
  ): Promise<PuhEvent<N>[]> {
    return (await this.eventsAnswer(name, query)).events;
  }

  /**
   * events(), with whether the last run's history answered part of it (pages only). A log of that
   * history that does not decode never fails a page: this run's history answers instead.
   */
  async eventsAnswer<N extends PuhEventName>(
    name: N,
    { id, ...query }: LogQuery & { id?: Hex } = {}
  ): Promise<PuhEventsAnswer<N>> {
    if (query.provisional) await this.#seedComing.wait();
    const answer = await (await this.#index()).index.read(query);
    if (answer.provisionalTo === null) return decodeEvents(name, id, answer);
    try {
      return decodeEvents(name, id, answer);
    } catch {
      return this.eventsAnswer(name, { ...query, id, provisional: false });
    }
  }

  /** The one `name` event for `id` in the whole history, or null. Two or more is an error. */
  async single<N extends PuhEventName>(
    name: N,
    id: Hex,
    query: Omit<LogQuery, "fromBlock" | "toBlock"> = {}
  ): Promise<PuhEvent<N> | null> {
    return (await this.singleAnswer(name, id, query)).event;
  }

  /** single() for pages: only this run's history can make two events an error. */
  async singleAnswer<N extends PuhEventName>(
    name: N,
    id: Hex,
    query: Omit<LogQuery, "fromBlock" | "toBlock"> = {}
  ): Promise<{ event: PuhEvent<N> | null; provisional: boolean }> {
    let answer = await this.eventsAnswer(name, { ...query, id });
    if (answer.events.length > 1 && answer.provisional)
      answer = await this.eventsAnswer(name, { ...query, id, provisional: false });
    const { events, provisional } = answer;
    if (events.length > 1)
      throw new IndexIntegrityError(
        `The ProtocolUpgradeHandler emitted ${events.length} ${name} events for ${id}; expected at most one.`
      );
    return { event: events[0] ?? null, provisional };
  }

  /** Whether the index holds the pinned canary log; null without a canary or before its block. */
  async hasCanary(): Promise<boolean | null> {
    const { net, index } = await this.#index();
    const canary = net.logCanary;
    if (!canary || !isAddressEqual(canary.address, net.upgradeHandler)) return null;
    const range = index.finalRange();
    if (!range || canary.blockNumber < range.from || canary.blockNumber > range.to) return null;
    const logs = await index.logs({
      fromBlock: canary.blockNumber,
      toBlock: canary.blockNumber,
      waitMs: 0,
    });
    const topic0 = canary.topic0.toLowerCase();
    return logs.some((log) => log.topics[0]?.toLowerCase() === topic0);
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

/** The `name` events (for `id`, when given) in an index answer, decoded; throws on a bad log. */
function decodeEvents<N extends PuhEventName>(
  name: N,
  id: Hex | undefined,
  { logs, finalTo, provisionalTo }: IndexRead
): PuhEventsAnswer<N> {
  const topic0 = topicOf(name);
  const wanted = id?.toLowerCase();
  const out: PuhEvent<N>[] = [];
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== topic0) continue;
    if (wanted !== undefined && log.topics[1]?.toLowerCase() !== wanted) continue;
    const { args } = decodeEventLog({
      abi: upgradeHandlerAbi,
      eventName: name as PuhEventName,
      topics: log.topics,
      data: log.data,
    });
    const provisional = provisionalTo !== null && log.blockNumber <= provisionalTo;
    out.push({
      args: args as PuhEvent<N>["args"],
      log,
      final: !provisional && log.blockNumber <= finalTo,
      provisional,
    });
  }
  return { events: out, provisional: provisionalTo !== null };
}

let instance: PuhIndex | undefined;

/** The handler index for the current data source settings. A settings change discards it. */
export function puhIndex(): PuhIndex {
  const generation = rpcGeneration();
  if (instance?.generation !== generation) {
    instance?.close();
    instance = new PuhIndex(generation);
  }
  return instance;
}
