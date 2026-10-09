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

// Reads at one block, gathered into as few Multicall3 aggregate3 calls as possible: whatever is
// asked at the same head within a few milliseconds (the sync engine's per-block snapshot, the
// verdicts of the signature sets on screen, Safe info, a request's upgrade states) goes out as one
// eth_call, pinned to the head's block NUMBER (as every read at a head is), without a `gas` field,
// every sub-call allowed to fail. Each sub-call gets its own (success, returnData): what an answer
// means is decided by the caller, and a failed sub-call is never a definite answer (it carries no
// error code, and one that ran out of gas looks like a revert; chain/call.ts).
//
// A guard rides along in every aggregate: Multicall3's getBlockNumber() and getLastBlockHash().
// Providers run an eth_call "at block M" either in block M's context (number M, last hash = M's
// parent) or in the next block's (number M+1, last hash = M's own hash); an answer that fits
// neither came from another block (a load-balanced backend on another branch, or one that ignored
// the block asked for), and every sub-call of it is unanswered (AnsweredOtherBlock). The two
// conventions overlap: (M+1, hash of M) is also what a backend of the first kind answers when it
// runs block M+1 (one block ahead), and (M, parent of M) what one of the second kind answers when
// it runs M-1 (one behind). So once the provider has answered LEARN_GUARD_AFTER aggregates in one
// convention and none in the other under the current settings, the other one is an answer from
// another block too. (A provider that showed both early keeps both.) A whole-call failure (an RPC
// error, the whole call out of gas, an answer that does not decode) is unanswered too
// (AggregateFailed): never a verdict, never a value.

/** Every sub-call of an aggregate3 is unanswered: the call failed as a whole. */
export class AggregateFailed extends UpstreamError {
  override name = "AggregateFailed";
}

/** The answer came from another block than the one asked for (see the guard above). */
export class AnsweredOtherBlock extends AggregateFailed {
  override name = "AnsweredOtherBlock";
}

/**
 * The settings changed while the aggregate was out: what it read is for another data source and
 * is dropped. Not a failure of the provider (nothing to learn about it from this).
 */
export class AggregateDropped extends AggregateFailed {
  override name = "AggregateDropped";
}

export type SubCall = {
  target: Address;
  callData: Hex;
  /** A signature verdict (at most MAX_VERDICTS of them per aggregate); default "value". */
  kind?: "verdict" | "value";
};

export type SubResult = { success: boolean; returnData: Hex };

/** How providers answered the guard: in block M's context, or the next block's. */
export type GuardConvention = "block" | "next-block";

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

// Sub-calls asked within this long of the first one at a head go out together.
const WAIT_MS = 10;
// Signature verdicts per aggregate (each up to ~50k gas; 64 measured well within providers' caps).
export const MAX_VERDICTS = 64;
// Sub-calls per aggregate besides the guard.
const MAX_CALLS = 160;
// A backend behind the one that named the head does not know it yet; the next one usually does.
const UNKNOWN_BLOCK_RETRY_MS = 300;
// Aggregates answered in one guard convention (and none in the other) after which the provider's
// convention is known for the settings generation (see the top).
export const LEARN_GUARD_AFTER = 8;

type Pending = {
  call: SubCall;
  resolve: (result: SubResult) => void;
  reject: (error: Error) => void;
  /** Asked by the sync engine's own work (paced), not by a request. */
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

// The guard conventions seen under one settings generation (see the top).
let seen = { generation: -1, block: 0, "next-block": 0 };

/** Counts an answer in `convention` under settings `generation` (only the current one's). */
function noteConvention(generation: number, convention: GuardConvention) {
  if (generation !== rpcGeneration()) return;
  if (seen.generation !== generation) seen = { generation, block: 0, "next-block": 0 };
  seen[convention]++;
}

/** The provider's convention, once known under settings `generation` (see the top); else null. */
function learnedConvention(generation: number): GuardConvention | null {
  if (seen.generation !== generation) return null;
  const counts = seen;
  if (counts.block >= LEARN_GUARD_AFTER && counts["next-block"] === 0) return "block";
  if (counts["next-block"] >= LEARN_GUARD_AFTER && counts.block === 0) return "next-block";
  return null;
}

const log = defaultLogger.child({ module: "aggregate" });

/**
 * One sub-call at `head`, sent with whatever else is asked at that head in the next few
 * milliseconds. Resolves with its own (success, returnData) once the aggregate's guard passed;
 * rejects with AggregateFailed (AnsweredOtherBlock for the guard, AggregateDropped after a
 * settings change) when the whole call has no usable answer. Every sub-call of one aggregate3
 * rejects with the same error instance (one failure of the provider, however many it carried).
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

/** Several sub-calls at `head`, in the same aggregate when they fit (see aggregateAt). */
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

/**
 * Throws AnsweredOtherBlock unless the guard's answers fit block `head` in a convention the
 * provider may use under settings `generation` (see the top).
 */
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
    // Only answers of an allowed convention teach it (one of the other kind after it was
    // learned is an answer from another block, below).
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
  /** aggregate3 calls sent through here, their sub-calls (the guard aside), and whole-call failures. */
  aggregates: number;
  subCalls: number;
  failures: number;
  guard: {
    /** How the provider answered the guard so far: in block M's context, or the next block's. */
    conventions: Record<GuardConvention, number>;
    /**
     * The provider's convention once known under the current settings (LEARN_GUARD_AFTER answers
     * in it and none in the other): answers in the other one then count as from another block.
     */
    learned: GuardConvention | null;
    /** Answers for another block (their values unknown), and the last one. */
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

/** The sub-call's return data as one 32-byte word, or null when it did not succeed with one. */
export function wordOf(result: SubResult): Hex | null {
  return word(result);
}
