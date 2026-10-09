import { defaultLogger } from "@config/log.server";
import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  hexToBigInt,
  isHex,
  multicall3Abi,
  numberToHex,
  parseAbi,
} from "viem";
import { type BlockRef, lanes, rpcGeneration } from "../rpc";
import { asEngineWork, asRequestWork, isEngineWork } from "../sync/pacer";
import { UpstreamError, isUnknownBlock } from "./call";
import { LaneError } from "./jsonrpc";

// Reads at one block, gathered into as few Multicall3 aggregate3 calls as possible: whatever is
// asked at the same head within a few milliseconds goes out as one eth_call at the head's block
// NUMBER, every sub-call allowed to fail. A failed sub-call is never a definite answer: it carries
// no error code, and one that ran out of gas looks like a revert (chain/call.ts).
//
// A guard rides along: Multicall3's getBlockNumber() and getLastBlockHash(). Providers run a call
// "at block M" in M's context (M, parent of M) or the next block's (M+1, hash of M); an answer that
// fits neither came from another block (AnsweredOtherBlock). The two overlap one block apart, so
// once a provider answered LEARN_GUARD_AFTER aggregates in one convention and none in the other,
// the other is from another block too. A whole-call failure is AggregateFailed: never a value.

/** Every sub-call of an aggregate3 is unanswered: the call failed as a whole. */
export class AggregateFailed extends UpstreamError {
  override name = "AggregateFailed";
}

/** The answer came from another block than the one asked for (see the guard above). */
export class AnsweredOtherBlock extends AggregateFailed {
  override name = "AnsweredOtherBlock";
}

/** The settings changed while it was out, or it was never sent: not the provider's failure. */
export class AggregateDropped extends AggregateFailed {
  override name = "AggregateDropped";
}

type SubCall = {
  target: Address;
  callData: Hex;
  /** A signature verdict (at most MAX_VERDICTS of them per aggregate); default "value". */
  kind?: "verdict" | "value";
};

export type SubResult = { success: boolean; returnData: Hex };

type GuardConvention = "block" | "next-block";

// Multicall3, at the same address on mainnet, Sepolia and their forks (rpc.ts MULTICALL3).
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const guardAbi = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getLastBlockHash() view returns (bytes32 blockHash)",
]);
const GUARD_CALLS: readonly SubCall[] = [
  {
    target: MULTICALL3,
    callData: encodeFunctionData({ abi: guardAbi, functionName: "getBlockNumber" }),
  },
  {
    target: MULTICALL3,
    callData: encodeFunctionData({ abi: guardAbi, functionName: "getLastBlockHash" }),
  },
];

const WAIT_MS = 10;
// Signature verdicts per aggregate (each up to ~50k gas; 64 measured well within providers' caps).
export const MAX_VERDICTS = 64;
const MAX_CALLS = 160;
// A backend behind the one that named the head does not know it yet; the next one usually does.
const UNKNOWN_BLOCK_RETRY_MS = 300;
export const LEARN_GUARD_AFTER = 8;

type Pending = {
  call: SubCall;
  resolve: (result: SubResult) => void;
  reject: (error: Error) => void;
  engine: boolean;
};

type Batch = {
  generation: number;
  head: BlockRef;
  calls: Pending[];
};

const batches = new Map<string, Batch>();

const stats = {
  aggregates: 0,
  subCalls: 0,
  failures: 0,
  guard: {
    conventions: { block: 0, "next-block": 0 } as Record<GuardConvention, number>,
    failures: 0,
    lastFailure: null as { block: string; answered: string | null } | null,
  },
};

let seen = { generation: -1, block: 0, "next-block": 0 };

function noteConvention(generation: number, convention: GuardConvention) {
  if (generation !== rpcGeneration()) return;
  if (seen.generation !== generation) seen = { generation, block: 0, "next-block": 0 };
  seen[convention]++;
}

function learnedConvention(generation: number): GuardConvention | null {
  if (seen.generation !== generation) return null;
  const counts = seen;
  if (counts.block >= LEARN_GUARD_AFTER && counts["next-block"] === 0) return "block";
  if (counts["next-block"] >= LEARN_GUARD_AFTER && counts.block === 0) return "next-block";
  return null;
}

const log = defaultLogger.child({ module: "aggregate" });

/**
 * One sub-call at `head`, sent with whatever else is asked there in the next few milliseconds.
 * Rejects with AggregateFailed when the whole call has no usable answer (the same error instance
 * for every sub-call of one aggregate3: one failure of the provider).
 */
export function aggregateAt(head: BlockRef, call: SubCall): Promise<SubResult> {
  const generation = rpcGeneration();
  const key = `${generation}:${head.hash.toLowerCase()}`;
  return new Promise<SubResult>((resolve, reject) => {
    let batch = batches.get(key);
    if (!batch) {
      batch = { generation, head, calls: [] };
      batches.set(key, batch);
      const timer = setTimeout(() => {
        batches.delete(key);
        flush(batch as Batch);
      }, WAIT_MS);
      (timer as { unref?: () => void }).unref?.();
    }
    batch.calls.push({ call, resolve, reject, engine: isEngineWork() });
  });
}

export function aggregateAllAt(head: BlockRef, calls: readonly SubCall[]): Promise<SubResult[]> {
  return Promise.all(calls.map((call) => aggregateAt(head, call)));
}

function chunks(calls: Pending[]): Pending[][] {
  const out: Pending[][] = [];
  let current: Pending[] = [];
  let verdicts = 0;
  for (const pending of calls) {
    const verdict = pending.call.kind === "verdict";
    if (current.length >= MAX_CALLS || (verdict && verdicts >= MAX_VERDICTS)) {
      out.push(current);
      current = [];
      verdicts = 0;
    }
    current.push(pending);
    if (verdict) verdicts++;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function flush(batch: Batch) {
  for (const chunk of chunks(batch.calls)) void send(batch, chunk);
}

async function send(batch: Batch, chunk: Pending[]) {
  // The engine's own aggregate waits its turn (sync/pacer.ts); one a request added to goes now.
  const engineOnly = chunk.every((pending) => pending.engine);
  const read = () =>
    readAggregate(
      batch.head,
      chunk.map((pending) => pending.call),
      batch.generation
    );
  let results: SubResult[] | null = null;
  let failure: AggregateFailed | null = null;
  try {
    results = await (engineOnly ? asEngineWork(read) : asRequestWork(read));
  } catch (error) {
    failure =
      error instanceof AggregateFailed
        ? error
        : new AggregateFailed(error instanceof Error ? error.message : String(error), {
            cause: error,
          });
  }
  // Settings changed meanwhile: what it read (or how it failed) is for another data source.
  if (rpcGeneration() !== batch.generation)
    failure = new AggregateDropped("The data source settings changed during the read");
  if (failure !== null || results === null) {
    const error = failure ?? new AggregateFailed("aggregate3 gave no answer");
    for (const pending of chunk) pending.reject(error);
    return;
  }
  const answers = results;
  chunk.forEach((pending, i) => pending.resolve(answers[i] as SubResult));
}

async function readAggregate(
  head: BlockRef,
  calls: readonly SubCall[],
  generation: number
): Promise<SubResult[]> {
  const all = [...GUARD_CALLS, ...calls];
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [
      all.map((call) => ({ target: call.target, allowFailure: true, callData: call.callData })),
    ],
  });
  const params = [{ to: MULTICALL3, data }, numberToHex(head.number)];
  stats.aggregates++;
  stats.subCalls += calls.length;
  let answer: unknown;
  try {
    try {
      answer = await lanes().call.request<unknown>("eth_call", params);
    } catch (error) {
      if (!isUnknownBlock(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
      answer = await lanes().call.request<unknown>("eth_call", params);
    }
  } catch (error) {
    // Never sent (the engine may no longer send, or a reset lane): not the provider's failure.
    if (error instanceof LaneError && error.kind === "aborted")
      throw new AggregateDropped(`aggregate3 at block ${head.number}: not sent`, { cause: error });
    stats.failures++;
    // Lane errors carry no URL (chain/jsonrpc.ts scrubs them).
    const message = error instanceof Error ? error.message : String(error);
    throw new AggregateFailed(`aggregate3 at block ${head.number}: ${message}`, { cause: error });
  }
  let results: readonly SubResult[];
  try {
    if (typeof answer !== "string" || !isHex(answer) || answer === "0x") throw new Error("no data");
    results = decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      data: answer,
    }) as readonly SubResult[];
  } catch {
    stats.failures++;
    throw new AggregateFailed(`aggregate3 at block ${head.number} returned no usable answer`);
  }
  if (results.length !== all.length) {
    stats.failures++;
    throw new AggregateFailed(
      `aggregate3 at block ${head.number} answered the wrong number of calls`
    );
  }
  checkGuard(head, generation, results[0] as SubResult, results[1] as SubResult);
  return results
    .slice(GUARD_CALLS.length)
    .map((r) => ({ success: r.success, returnData: r.returnData }));
}

function word(result: SubResult): Hex | null {
  return result.success && /^0x[0-9a-fA-F]{64}$/.test(result.returnData) ? result.returnData : null;
}

function checkGuard(
  head: BlockRef,
  generation: number,
  numberResult: SubResult,
  hashResult: SubResult
) {
  const numberWord = word(numberResult);
  const hashWord = word(hashResult);
  const number = numberWord === null ? null : hexToBigInt(numberWord);
  const last = hashWord?.toLowerCase() ?? null;
  let convention: GuardConvention | null = null;
  if (number === head.number && last === head.parentHash.toLowerCase()) convention = "block";
  else if (number === head.number + 1n && last === head.hash.toLowerCase())
    convention = "next-block";
  const learned = learnedConvention(generation);
  if (convention !== null && (learned === null || convention === learned)) {
    stats.guard.conventions[convention]++;
    noteConvention(generation, convention);
    return;
  }
  stats.guard.failures++;
  stats.guard.lastFailure = {
    block: head.number.toString(),
    answered: number === null ? null : number.toString(),
  };
  if (stats.guard.failures === 1 || stats.guard.failures % 100 === 0)
    log.warn(
      {
        block: head.number.toString(),
        answered: number?.toString() ?? null,
        failures: stats.guard.failures,
      },
      "aggregate3 answered for another block; its values are unknown at the head"
    );
  throw new AnsweredOtherBlock(
    `aggregate3 at block ${head.number} was answered for ${number === null ? "an unknown block" : `block ${number}`}`
  );
}

export type AggregateStatus = {
  aggregates: number;
  subCalls: number;
  failures: number;
  guard: {
    conventions: Record<GuardConvention, number>;
    learned: GuardConvention | null;
    failures: number;
    lastFailure: { block: string; answered: string | null } | null;
  };
};

export function aggregateStatus(): AggregateStatus {
  return {
    aggregates: stats.aggregates,
    subCalls: stats.subCalls,
    failures: stats.failures,
    guard: {
      conventions: { ...stats.guard.conventions },
      learned: learnedConvention(rpcGeneration()),
      failures: stats.guard.failures,
      lastFailure: stats.guard.lastFailure && { ...stats.guard.lastFailure },
    },
  };
}

/** Forgets the counts and the convention learned (tests). */
export function resetAggregateStatus() {
  stats.aggregates = 0;
  stats.subCalls = 0;
  stats.failures = 0;
  stats.guard.conventions = { block: 0, "next-block": 0 };
  stats.guard.failures = 0;
  stats.guard.lastFailure = null;
  seen = { generation: -1, block: 0, "next-block": 0 };
}

export function wordOf(result: SubResult): Hex | null {
  return word(result);
}
