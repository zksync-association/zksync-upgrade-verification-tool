// A fake ZKsync Era behind fakeJsonRpc, for the L2 governor index and the flows that read it:
// the three pinned mainnet governors' ProposalCreated / ProposalExecuted / ProposalCanceled logs
// (plus VoteCast noise a topic filter must leave out), Era-like block times (about 0.7 s, several
// blocks sharing a second), Governor.state(id) over eth_call, execution receipts with their
// L2 → L1 message, and zks_getL2ToL1LogProof. Every call is recorded.

import { l1MessengerEventAbi, l2GovernorAbi } from "@/common/abis";
import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAbiItem,
  keccak256,
  numberToHex,
  pad,
  toEventSelector,
  toHex,
} from "viem";
import { type ChainLog, type FakeChainOptions, blockHash, fakeChain, txHash } from "./fake-chain";
import { type FakeCall, FakeRpcError } from "./fake-jsonrpc";

export const ERA_URL = "http://era.invalid/rpc";

// Mainnet's pinned governors (common/networks.ts).
export const GOVERNORS = {
  token: "0xb83FF6501214ddF40C91C9565d095400f3F45746",
  govOps: "0xEEEa739a8b6fB1b8f703E23C9Be03CeeA643b160",
  protocol: "0x76705327e682F2d96943280D99464Ab61219e34f",
} as const satisfies Record<string, Address>;

export const FIRST_LOG = 49_077_771n;
export const HEAD = 72_352_499n;
export const FINAL = HEAD - 1_985n;
const BASE = 1_700_000_000n;
export const DAY = 86_400n;
const L1_MESSENGER: Address = "0x0000000000000000000000000000000000008008";

/** Era-like block times: 0.7 s per block on average, several blocks sharing a second. */
export const timeOf = (n: bigint) => BASE + (n * 7n) / 10n;

/** The first block timed at or after `t` (what a timestamp search finds). */
export function firstBlockAt(t: bigint): bigint {
  let n = ((t - BASE) * 10n) / 7n;
  while (timeOf(n) < t) n++;
  while (n > 0n && timeOf(n - 1n) >= t) n--;
  return n;
}

const TOPIC = {
  created: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalCreated" })[0] as Hex,
  executed: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalExecuted" })[0] as Hex,
  canceled: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalCanceled" })[0] as Hex,
  vote: toEventSelector("VoteCast(address,uint256,uint8,uint256,string)"),
};

export type EraProposal = {
  governor: Address;
  description: string;
  created: bigint;
  /** Governor.state(id); an Error makes the read fail. */
  state: number | Error;
  executed?: bigint;
  canceled?: bigint;
  /** For an execution: the L2 → L1 message body, and its L1 batch (null: not in one yet). */
  message?: Hex;
  l1Batch?: bigint | null;
};

export function proposalContent(description: string) {
  return {
    targets: ["0x0000000000000000000000000000000000000b01"] as Address[],
    values: [0n],
    calldatas: ["0x1234"] as Hex[],
    description,
  };
}

export function proposalIdOf(description: string): bigint {
  const c = proposalContent(description);
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [c.targets, c.values, c.calldatas, keccak256(toHex(c.description))]
      )
    )
  );
}

const created = getAbiItem({ abi: l2GovernorAbi, name: "ProposalCreated" });

function logsOf(proposals: readonly EraProposal[]): ChainLog[] {
  const logs: ChainLog[] = [];
  // Every event at log index 0 of its own block (scenarios keep the blocks apart); a proposal's
  // vote is log index 1 of its creation block.
  for (const p of proposals) {
    const id = proposalIdOf(p.description);
    const c = proposalContent(p.description);
    logs.push({
      address: p.governor,
      blockNumber: p.created,
      logIndex: 0,
      topics: [TOPIC.created],
      data: encodeAbiParameters(created.inputs, [
        id,
        "0x0000000000000000000000000000000000000c01",
        c.targets,
        c.values,
        [""],
        c.calldatas,
        p.created + 100n,
        p.created + 200n,
        c.description,
      ]),
    });
    // A vote right after: only an address-only filter would return it.
    logs.push({
      address: p.governor,
      blockNumber: p.created,
      logIndex: 1,
      topics: [TOPIC.vote, pad("0x0c02", { size: 32 })],
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "string" }],
        [id, 1, 10n, ""]
      ),
    });
    for (const [block, topic] of [
      [p.executed, TOPIC.executed],
      [p.canceled, TOPIC.canceled],
    ] as const) {
      if (block === undefined) continue;
      logs.push({
        address: p.governor,
        blockNumber: block,
        logIndex: 0,
        topics: [topic],
        data: encodeAbiParameters([{ type: "uint256" }], [id]),
      });
    }
  }
  return logs.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1
  );
}

/** The transaction hash of `p`'s execution log. */
export const executionTx = (p: EraProposal) =>
  txHash({ blockNumber: p.executed as bigint, logIndex: 0 });

export function fakeEra(proposals: EraProposal[], options: Partial<FakeChainOptions> = {}) {
  const chain = fakeChain({
    address: GOVERNORS.token,
    logs: logsOf(proposals),
    head: { number: HEAD },
    finalized: FINAL,
    timestampOf: timeOf,
    ...options,
  });
  const calls: FakeCall[] = [];
  const era = {
    chain,
    proposals,
    calls,
    /** Calls of `method` (with eth_getBlockByNumber: only those naming a block number). */
    count(method: string, numeric = false) {
      return calls.filter(
        (c) =>
          c.method === method &&
          (!numeric || (typeof c.params[0] === "string" && /^0x[0-9a-f]+$/i.test(c.params[0])))
      ).length;
    },
    /** Rebuilds the logs after `proposals` changed. */
    relog() {
      chain.options.logs = logsOf(proposals);
    },
    /** Moves the head (a new hash unless given) and its 'finalized' block. */
    setHead(number: bigint, { salt = 0, finalized = number - 1_985n } = {}) {
      chain.options.head = { number, hash: blockHash(number, salt) };
      chain.options.finalized = finalized;
    },
    handle(call: FakeCall): unknown {
      calls.push(call);
      if (call.method === "eth_chainId") return "0x144";
      if (call.method === "eth_call") return stateOf(call);
      if (call.method === "eth_getTransactionReceipt") return receiptOf(call.params[0] as Hex);
      if (call.method === "zks_getL2ToL1LogProof")
        return { id: 5, proof: [pad("0x99", { size: 32 })], root: pad("0x98", { size: 32 }) };
      return chain.handle(call);
    },
  };

  function stateOf(call: FakeCall) {
    const { to, data } = call.params[0] as { to: Address; data: Hex };
    const { functionName, args } = decodeFunctionData({ abi: l2GovernorAbi, data });
    if (functionName !== "state") return new FakeRpcError(-32601, `no ${functionName} here`);
    const id = args[0] as bigint;
    const p = proposals.find(
      (q) => q.governor.toLowerCase() === to.toLowerCase() && proposalIdOf(q.description) === id
    );
    if (!p) return new FakeRpcError(3, "execution reverted: Governor: unknown proposal id");
    if (p.state instanceof Error) return new FakeRpcError(-32603, p.state.message);
    return encodeFunctionResult({ abi: l2GovernorAbi, functionName: "state", result: p.state });
  }

  function receiptOf(hash: Hex) {
    const p = proposals.find((q) => q.executed !== undefined && executionTx(q) === hash);
    if (!p) return null;
    const block = p.executed as bigint;
    const batch = p.l1Batch === undefined ? 500n : p.l1Batch;
    const raw = (log: { address: Address; topics: Hex[]; data: Hex }, index: number) => ({
      ...log,
      blockNumber: numberToHex(block),
      blockHash: blockHash(block),
      transactionHash: hash,
      transactionIndex: "0x0",
      logIndex: numberToHex(index),
      transactionLogIndex: numberToHex(index),
      logType: null,
      l1BatchNumber: batch === null ? null : numberToHex(batch),
      removed: false,
    });
    const logs = [
      raw(
        {
          address: p.governor,
          topics: [TOPIC.executed],
          data: encodeAbiParameters([{ type: "uint256" }], [proposalIdOf(p.description)]),
        },
        0
      ),
    ];
    if (p.message) {
      logs.push(
        raw(
          {
            address: L1_MESSENGER,
            topics: encodeEventTopics({
              abi: l1MessengerEventAbi,
              eventName: "L1MessageSent",
              args: { _sender: p.governor, _hash: keccak256(p.message) },
            }) as Hex[],
            data: encodeAbiParameters([{ type: "bytes" }], [p.message]),
          },
          1
        )
      );
    }
    return {
      blockHash: blockHash(block),
      blockNumber: numberToHex(block),
      contractAddress: null,
      cumulativeGasUsed: "0x0",
      effectiveGasPrice: "0x0",
      from: "0x0000000000000000000000000000000000000c01",
      gasUsed: "0x0",
      logs,
      logsBloom: `0x${"00".repeat(256)}`,
      status: "0x1",
      to: p.governor,
      transactionHash: hash,
      transactionIndex: "0x0",
      type: "0x2",
      l1BatchNumber: batch === null ? null : numberToHex(batch),
      l1BatchTxIndex: batch === null ? null : "0x3",
      l2ToL1Logs: [],
    };
  }

  return era;
}
