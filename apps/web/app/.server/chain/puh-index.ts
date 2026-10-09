import { upgradeHandlerAbi } from "@/common/abis";
import { env } from "@config/env.server";
import {
  type ContractEventName,
  type DecodeEventLogReturnType,
  type Hex,
  decodeEventLog,
  encodeEventTopics,
  isAddressEqual,
} from "viem";
import { type Network, chainHead, lanes, network, rpcGeneration } from "../rpc";
import { scrubText, secretsOf } from "./jsonrpc";
import {
  IndexClosed,
  type IndexStatus,
  type IndexedLog,
  type LogIndex,
  type LogQuery,
  createLogIndex,
} from "./log-index";

// The ProtocolUpgradeHandler's log index: every log the handler (and its proxy) has emitted since
// upgradeHandlerDeployBlock, read once and kept for the settings generation. Mainnet holds about a
// hundred logs, so lists and per-id lookups filter memory instead of scanning the chain.

export type PuhEventName = ContractEventName<typeof upgradeHandlerAbi>;

export type PuhEvent<N extends PuhEventName = PuhEventName> = {
  args: DecodeEventLogReturnType<typeof upgradeHandlerAbi, N>["args"];
  log: IndexedLog;
};

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

export class PuhIndex {
  #built: Built | undefined;
  #error: string | null = null;
  #closed = false;

  constructor(readonly generation: number) {}

  #current = () => !this.#closed && rpcGeneration() === this.generation;

  /** The index for the chain and handler the current network() reports (one per chain/address). */
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
      this.#built = {
        key,
        net,
        index: createLogIndex({
          label: "ProtocolUpgradeHandler",
          lane: lanes().history,
          address: net.upgradeHandler,
          deployBlock: net.upgradeHandlerDeployBlock,
          head: chainHead,
          isCurrent: this.#current,
          describeError: describe,
        }),
      };
    }
    this.#error = null;
    return this.#built;
  }

  /** Starts or resumes the backfill. Never rejects. */
  async startBackfill(): Promise<void> {
    try {
      await (await this.#index()).index.startBackfill();
    } catch {
      // Reported through status().
    }
  }

  status(): PuhIndexStatus {
    if (this.#built) return this.#built.index.status();
    return this.#error ? { ...IDLE, state: "unavailable", error: this.#error } : { ...IDLE };
  }

  /** Every handler log in the range, complete (waits for the backfill, bounded). */
  async logs(query?: LogQuery): Promise<IndexedLog[]> {
    return (await this.#index()).index.logs(query);
  }

  /** Decoded `name` events, optionally for one id (topic 1), oldest first. */
  async events<N extends PuhEventName>(
    name: N,
    { id, ...query }: LogQuery & { id?: Hex } = {}
  ): Promise<PuhEvent<N>[]> {
    const topic0 = topicOf(name);
    const wanted = id?.toLowerCase();
    const out: PuhEvent<N>[] = [];
    for (const log of await this.logs(query)) {
      if (log.topics[0]?.toLowerCase() !== topic0) continue;
      if (wanted !== undefined && log.topics[1]?.toLowerCase() !== wanted) continue;
      const { args } = decodeEventLog({
        abi: upgradeHandlerAbi,
        eventName: name as PuhEventName,
        topics: log.topics,
        data: log.data,
      });
      out.push({ args: args as PuhEvent<N>["args"], log });
    }
    return out;
  }

  /** The one `name` event for `id` in the whole history, or null. Two or more is an error. */
  async single<N extends PuhEventName>(
    name: N,
    id: Hex,
    query: Omit<LogQuery, "fromBlock" | "toBlock"> = {}
  ): Promise<PuhEvent<N> | null> {
    const events = await this.events(name, { ...query, id });
    if (events.length > 1)
      throw new IndexIntegrityError(
        `The ProtocolUpgradeHandler emitted ${events.length} ${name} events for ${id}; expected at most one.`
      );
    return events[0] ?? null;
  }

  /**
   * Whether the index holds the pinned canary log (the handler's deployment event). null when the
   * network has no canary on this handler, or the backfill has not reached its block yet.
   */
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
  }
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
