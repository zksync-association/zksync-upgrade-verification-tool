// A fake chain behind fakeJsonRpc for log index tests: eth_getLogs over in-memory logs (with an
// optional Infura-like range cap) and blocks by number, hash or tag. Every query is recorded.

import { type UpgradeProposal, encodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { type Address, type Hex, hexToBigInt, numberToHex, pad, toEventSelector } from "viem";
import { type FakeCall, FakeRpcError } from "./fake-jsonrpc";

export type ChainLog = {
  blockNumber: bigint;
  logIndex: number;
  topics: Hex[];
  data?: Hex;
  /** Defaults to the chain's address. */
  address?: Address;
  removed?: boolean;
};

export type LogsQuery = { from: bigint; to: bigint; filter: Record<string, unknown> };

export type FakeChainOptions = {
  address: Address;
  logs: ChainLog[];
  /** Infura-like: to − from above this answers -32602 "range N exceeds limit of M". */
  cap?: bigint;
  /** Answers a query with an error (or a replacement list of raw logs) instead of the chain. */
  override?: (query: LogsQuery) => FakeRpcError | unknown[] | undefined;
  head?: { number: bigint; hash?: Hex; timestamp?: bigint };
  /** null: the node does not know the 'finalized' tag. */
  finalized?: bigint | null;
  /** Block timestamps (default: 12 s per block from 1,700,000,000). */
  timestampOf?: (n: bigint) => bigint;
};

export const blockHash = (n: bigint, salt = 0) =>
  pad(numberToHex(n * 1000n + BigInt(salt)), { size: 32 }) as Hex;
export const txHash = (log: { blockNumber: bigint; logIndex: number }) =>
  pad(numberToHex(log.blockNumber * 10_000n + BigInt(log.logIndex) + 7n), { size: 32 }) as Hex;

export function rawLog(chain: { address: Address }, log: ChainLog) {
  return {
    address: (log.address ?? chain.address).toLowerCase(),
    topics: log.topics,
    data: log.data ?? "0x",
    blockNumber: numberToHex(log.blockNumber),
    blockHash: blockHash(log.blockNumber),
    transactionHash: txHash(log),
    transactionIndex: "0x0",
    logIndex: numberToHex(log.logIndex),
    removed: log.removed ?? false,
  };
}

function rawBlock(number: bigint, hash?: Hex, timestamp?: bigint) {
  return {
    number: numberToHex(number),
    hash: hash ?? blockHash(number),
    parentHash: blockHash(number - 1n),
    timestamp: numberToHex(timestamp ?? 1_700_000_000n + number * 12n),
  };
}

export function fakeChain(options: FakeChainOptions) {
  const queries: LogsQuery[] = [];
  const chain = {
    options,
    queries,
    /** eth_getLogs queries, as [from, to]. */
    ranges: () => queries.map((q) => [q.from, q.to] as const),
    handle(call: FakeCall): unknown {
      if (call.method === "eth_chainId") return "0x1";
      if (call.method === "eth_getBlockByNumber") {
        const tag = call.params[0];
        const head = options.head ?? { number: 0n };
        const time = (n: bigint) => options.timestampOf?.(n);
        if (tag === "latest")
          return rawBlock(head.number, head.hash, head.timestamp ?? time(head.number));
        if (tag === "finalized") {
          if (options.finalized === null)
            return new FakeRpcError(-32602, "invalid block tag: finalized");
          const n = options.finalized ?? head.number - 80n;
          return rawBlock(n, undefined, time(n));
        }
        const n = BigInt(tag as string);
        return rawBlock(n, undefined, time(n));
      }
      if (call.method === "eth_getBlockByHash") {
        // blockHash(n, salt) encodes the number: n * 1000 + salt.
        const hash = call.params[0] as Hex;
        const head = options.head ?? { number: 0n };
        if (head.hash && hash.toLowerCase() === head.hash.toLowerCase())
          return rawBlock(
            head.number,
            head.hash,
            head.timestamp ?? options.timestampOf?.(head.number)
          );
        const n = hexToBigInt(hash) / 1000n;
        return rawBlock(n, hash, options.timestampOf?.(n));
      }
      if (call.method !== "eth_getLogs") return new FakeRpcError(-32601, "method not found");
      const filter = call.params[0] as Record<string, unknown>;
      const from = BigInt(filter.fromBlock as string);
      const to = BigInt(filter.toBlock as string);
      const query = { from, to, filter };
      queries.push(query);
      const replaced = options.override?.(query);
      if (replaced !== undefined) return replaced;
      if (options.cap !== undefined && to - from > options.cap)
        return new FakeRpcError(-32602, `range ${to - from} exceeds limit of ${options.cap}`);
      // One address, or eth_getLogs' OR-list of addresses.
      const addresses = (Array.isArray(filter.address) ? filter.address : [filter.address]).map(
        (a) => String(a).toLowerCase()
      );
      // Topic positions as eth_getLogs reads them: null matches anything, a list is an OR.
      const topics = (filter.topics ?? []) as (string | string[] | null)[];
      const matches = (log: ChainLog) =>
        topics.every((wanted, i) => {
          if (wanted === null) return true;
          const actual = log.topics[i]?.toLowerCase();
          return (Array.isArray(wanted) ? wanted : [wanted]).some(
            (t) => t.toLowerCase() === actual
          );
        });
      return options.logs
        .filter(
          (log) =>
            log.blockNumber >= from &&
            log.blockNumber <= to &&
            addresses.includes((log.address ?? options.address).toLowerCase()) &&
            matches(log)
        )
        .map((log) => rawLog(options, log));
    },
  };
  return chain;
}

/** `count` logs spread over [from, to], always including both ends. */
export function spreadLogs(count: number, from: bigint, to: bigint, topic = 1): ChainLog[] {
  const logs: ChainLog[] = [];
  for (let i = 0; i < count; i++) {
    const blockNumber = i === count - 1 ? to : from + ((to - from) * BigInt(i)) / BigInt(count - 1);
    logs.push({
      blockNumber,
      logIndex: i,
      topics: [pad(numberToHex(topic), { size: 32 }), pad(numberToHex(i), { size: 32 })],
    });
  }
  return logs;
}

// ---- ProtocolUpgradeHandler history ----

const selector = (signature: string) => toEventSelector(signature);
const word = (value: bigint | number | Hex) =>
  pad(typeof value === "string" ? value : numberToHex(value), { size: 32 }) as Hex;

export const PUH_TOPICS = {
  UpgradeStarted: selector("UpgradeStarted(bytes32,((address,uint256,bytes)[],address,bytes32))"),
  UpgradeApprovedBySecurityCouncil: selector("UpgradeApprovedBySecurityCouncil(bytes32)"),
  UpgradeExecuted: selector("UpgradeExecuted(bytes32)"),
  EmergencyUpgradeExecuted: selector("EmergencyUpgradeExecuted(bytes32)"),
  Unfreeze: selector("Unfreeze()"),
  ChangeSecurityCouncil: selector("ChangeSecurityCouncil(address,address)"),
  ChangeGuardians: selector("ChangeGuardians(address,address)"),
  ChangeEmergencyUpgradeBoard: selector("ChangeEmergencyUpgradeBoard(address,address)"),
  // The handler is a proxy: its own events share the address.
  Upgraded: "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b" as Hex,
  Initialized: "0xc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d2" as Hex,
  AdminChanged: "0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f" as Hex,
} as const;

export type PuhHistory = {
  logs: ChainLog[];
  upgrades: { id: Hex; proposal: UpgradeProposal; started: bigint; executed: bigint }[];
  emergencies: { id: Hex; block: bigint }[];
};

/**
 * Mainnet's handler history in shape: 98 logs from `from` to `to` (16 upgrades started, approved
 * and executed, 20 emergency upgrades, 20 unfreezes, council and board changes, 5 proxy logs),
 * with the ChangeSecurityCouncil canary at `from`.
 */
export function puhHistory(from: bigint, to: bigint): PuhHistory {
  const kinds: ((i: number) => { topics: Hex[]; data?: Hex; upgrade?: number; emergency?: Hex })[] =
    [];
  kinds.push(() => ({
    topics: [PUH_TOPICS.ChangeSecurityCouncil, word(0), word(0xc0de)],
  }));
  kinds.push(() => ({ topics: [PUH_TOPICS.Initialized], data: word(1) }));
  kinds.push(() => ({ topics: [PUH_TOPICS.AdminChanged], data: `0x${"00".repeat(64)}` }));
  for (let i = 0; i < 3; i++) kinds.push(() => ({ topics: [PUH_TOPICS.Upgraded, word(0x1a + i)] }));
  kinds.push(() => ({ topics: [PUH_TOPICS.ChangeGuardians, word(0), word(0x9a)] }));
  for (let i = 0; i < 2; i++)
    kinds.push(() => ({ topics: [PUH_TOPICS.ChangeEmergencyUpgradeBoard, word(i), word(i + 1)] }));
  kinds.push(() => ({ topics: [PUH_TOPICS.ChangeSecurityCouncil, word(0xc0de), word(0xc0df)] }));
  const proposals: UpgradeProposal[] = [];
  for (let i = 0; i < 16; i++) {
    const proposal: UpgradeProposal = {
      calls: [
        { target: `0x${(i + 1).toString(16).padStart(40, "0")}`, value: "0", data: "0x1234" },
      ],
      executor: "0x0000000000000000000000000000000000000000",
      salt: word(i),
    };
    proposals.push(proposal);
    const id = upgradeProposalId(proposal);
    kinds.push(() => ({
      topics: [PUH_TOPICS.UpgradeStarted, id],
      data: encodeUpgradeProposal(proposal),
      upgrade: i,
    }));
    kinds.push(() => ({ topics: [PUH_TOPICS.UpgradeApprovedBySecurityCouncil, id] }));
    kinds.push(() => ({ topics: [PUH_TOPICS.UpgradeExecuted, id], upgrade: i }));
  }
  for (let i = 0; i < 20; i++) {
    const id = word(0xe000 + i);
    kinds.push(() => ({ topics: [PUH_TOPICS.EmergencyUpgradeExecuted, id], emergency: id }));
    kinds.push(() => ({ topics: [PUH_TOPICS.Unfreeze] }));
  }

  const blocks = spreadLogs(kinds.length, from, to).map((log) => log.blockNumber);
  const logs: ChainLog[] = [];
  const started = new Map<number, bigint>();
  const executed = new Map<number, bigint>();
  const emergencies: PuhHistory["emergencies"] = [];
  kinds.forEach((kind, i) => {
    const { topics, data, upgrade, emergency } = kind(i);
    const blockNumber = blocks[i] as bigint;
    logs.push({ blockNumber, logIndex: 0, topics, data });
    if (upgrade !== undefined) {
      if (topics[0] === PUH_TOPICS.UpgradeStarted) started.set(upgrade, blockNumber);
      else executed.set(upgrade, blockNumber);
    }
    if (emergency) emergencies.push({ id: emergency, block: blockNumber });
  });
  return {
    logs,
    upgrades: proposals.map((proposal, i) => ({
      id: upgradeProposalId(proposal),
      proposal,
      started: started.get(i) as bigint,
      executed: executed.get(i) as bigint,
    })),
    emergencies,
  };
}
