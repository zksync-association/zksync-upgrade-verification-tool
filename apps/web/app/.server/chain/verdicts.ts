import { ERC1271_MAGIC_VALUE, guardiansAbi, safeAbi } from "@/common/abis";
import { type MemberSignature, encodeMultisigSignature, sortBySigner } from "@/common/execution";
import { env } from "@config/env.server";
import { defaultLogger } from "@config/log.server";
import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  isAddressEqual,
  parseAbi,
} from "viem";
import { cached } from "../cache";
import { type BlockRef, rpcGeneration } from "../rpc";
import { AggregateDropped, AggregateFailed, aggregateAt, wordOf } from "./aggregate";
import { noteCodePresent } from "./call";
import { codePins, hasPinnedCode } from "./pins";

// The verdict fast path: a set's checks at a head as sub-calls of the head's aggregate3 instead of
// one eth_call each. Only POSITIVES are taken from it, and only when:
// - every candidate is ECDSA only (65-byte segments, v 27, 28, 31 or 32: no contract signature,
//   no approved hash);
// - the check contract, and every member Safe whose code the check runs, runs pinned code (a Safe's
//   singleton and fallback handler are read in the same aggregate);
// - checkSignatures answers (true, 0x) and a getter of the same contract answers a word in the same
//   aggregate (a call to an address without code also "succeeds"); isValidSignature answers (true,
//   the ERC-1271 magic value).
// Anything else is no answer: the caller asks directly, where only a definite revert rejects. None
// of these paths reads msg.sender or tx.origin, so a positive here equals a direct one.

const log = defaultLogger.child({ module: "verdicts" });

const storageAbi = parseAbi([
  "function masterCopy() view returns (address)",
  "function getStorageAt(uint256 offset, uint256 length) view returns (bytes)",
]);
// keccak256("fallback_manager.handler.address"), Safe 1.3.0's FallbackManager slot.
const FALLBACK_HANDLER_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5n;

const ECDSA_V = new Set([27, 28, 31, 32]);

export function isEcdsaOnly(signature: Hex): boolean {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(signature)) return false;
  const bytes = (signature.length - 2) / 2;
  if (bytes === 0 || bytes % 65 !== 0) return false;
  for (let i = 0; i < bytes / 65; i++) {
    const at = 2 + (i * 65 + 64) * 2;
    if (!ECDSA_V.has(Number.parseInt(signature.slice(at, at + 2), 16))) return false;
  }
  return true;
}

export type FastCheck = {
  kind: "multisig" | "multisig-1271" | "safe-1271";
  contract: Address;
};

// After this many failed aggregates in a row the fast path rests (every check direct): a provider
// whose eth_call gas cap is below an aggregate's would otherwise fail every block's first.
const BREAKER_FAILURES = 3;
const BREAKER_REST_MS = 5 * 60_000;
let failuresInARow = 0;
let restingUntil = 0;
let breakerGeneration: number | null = null;
const counted = new WeakSet<AggregateFailed>();

function currentBreaker() {
  const generation = rpcGeneration();
  if (breakerGeneration === generation) return;
  breakerGeneration = generation;
  failuresInARow = 0;
  restingUntil = 0;
}

function enabled(): boolean {
  if (env.SYNC_VERDICT_AGGREGATE === 0) return false;
  currentBreaker();
  return Date.now() >= restingUntil;
}

function noteAnswered() {
  currentBreaker();
  failuresInARow = 0;
}

function noteFailed(error: unknown) {
  if (!(error instanceof AggregateFailed) || error instanceof AggregateDropped) return;
  if (counted.has(error)) return;
  counted.add(error);
  currentBreaker();
  if (++failuresInARow < BREAKER_FAILURES) return;
  failuresInARow = 0;
  restingUntil = Date.now() + BREAKER_REST_MS;
  log.warn({ restMs: BREAKER_REST_MS }, "aggregated verdicts failed repeatedly; checking directly");
}

export type VerdictCounts = {
  block: string;
  fast: number;
  reasked: number;
  /** Not for the fast path (supplied, non-ECDSA or empty candidates, unpinned contracts). */
  direct: number;
};

const counts = new Map<string, VerdictCounts>();
const COUNTS_KEPT = 8;

export function noteVerdict(block: bigint | undefined, outcome: "fast" | "reasked" | "direct") {
  if (block === undefined) return;
  const key = block.toString();
  let entry = counts.get(key);
  if (!entry) {
    entry = { block: key, fast: 0, reasked: 0, direct: 0 };
    counts.set(key, entry);
    while (counts.size > COUNTS_KEPT) counts.delete(counts.keys().next().value as string);
  }
  entry[outcome]++;
}

export function verdictCounts(block: string): VerdictCounts {
  const entry = counts.get(block);
  return entry ? { ...entry } : { block, fast: 0, reasked: 0, direct: 0 };
}

export function resetVerdicts() {
  counts.clear();
  failuresInARow = 0;
  restingUntil = 0;
  breakerGeneration = null;
}

/** The contract and the member Safes its check runs have pinned code (see pinnedSafesAt). */
async function pinnedCheck(check: FastCheck, members: readonly Address[]): Promise<boolean> {
  const pins = await codePins().catch(() => null);
  if (!pins) return false;
  const checks = await Promise.all([
    check.kind === "safe-1271"
      ? hasPinnedCode(check.contract, [pins.safeProxy])
      : hasPinnedCode(check.contract, [pins.securityCouncil, pins.guardians]),
    ...members.map((member) => hasPinnedCode(member, [pins.safeProxy])),
  ]);
  return checks.every(Boolean);
}

async function pinnedSafesAt(safes: readonly Address[], head: BlockRef): Promise<boolean> {
  const all = await Promise.all(safes.map((safe) => pinnedSafeAt(safe, head)));
  return all.every(Boolean);
}

/**
 * A getter answering a word at `head` shows the contract has code there, so that a void
 * checkSignatures success means something.
 */
function codeAt(contract: Address, head: BlockRef): Promise<boolean> {
  return cached(
    `aggregate-code:${contract.toLowerCase()}:${head.hash.toLowerCase()}`,
    60_000,
    async () => {
      const result = await aggregateAt(head, {
        target: contract,
        callData: encodeFunctionData({ abi: guardiansAbi, functionName: "EIP1271_THRESHOLD" }),
      });
      const present = wordOf(result) !== null;
      if (present) noteCodePresent(contract, head.hash);
      return present;
    }
  );
}

function pinnedSafeAt(safe: Address, head: BlockRef): Promise<boolean> {
  return cached(
    `aggregate-safe-profile:${safe.toLowerCase()}:${head.hash.toLowerCase()}`,
    60_000,
    async () => {
      const pins = await codePins();
      if (!pins) return false;
      const [singleton, handler] = await Promise.all([
        aggregateAt(head, {
          target: safe,
          callData: encodeFunctionData({ abi: storageAbi, functionName: "masterCopy" }),
        }),
        aggregateAt(head, {
          target: safe,
          callData: encodeFunctionData({
            abi: storageAbi,
            functionName: "getStorageAt",
            args: [FALLBACK_HANDLER_SLOT, 1n],
          }),
        }),
      ]);
      const singletonWord = wordOf(singleton);
      if (singletonWord === null || !handler.success) return false;
      let handlerWord: Hex;
      try {
        handlerWord = decodeFunctionResult({
          abi: storageAbi,
          functionName: "getStorageAt",
          data: handler.returnData,
        }) as Hex;
      } catch {
        return false;
      }
      if (!/^0x[0-9a-fA-F]{64}$/.test(handlerWord)) return false;
      const asAddress = (w: Hex) => getAddress(`0x${w.slice(-40)}`);
      return (
        isAddressEqual(asAddress(singletonWord), pins.safeSingleton) &&
        isAddressEqual(asAddress(handlerWord), pins.safeFallbackHandler)
      );
    }
  );
}

const isMagic = (data: Hex) => {
  try {
    return (
      decodeFunctionResult({ abi: safeAbi, functionName: "isValidSignature", data }) ===
      ERC1271_MAGIC_VALUE
    );
  } catch {
    return false;
  }
};

/** "not-accepted" is NOT a rejection: the caller asks directly. */
export type FastAnswer = "accepted" | "not-accepted" | "not-asked";

export async function fastAccepts(
  check: FastCheck,
  digest: Hex,
  signatures: readonly MemberSignature[],
  threshold: number,
  head: BlockRef
): Promise<FastAnswer> {
  if (!enabled() || signatures.length === 0) return "not-asked";
  if (!signatures.every((s) => isEcdsaOnly(s.signature))) return "not-asked";
  if (check.kind === "safe-1271" && signatures.length !== 1) return "not-asked";
  // The member Safes whose code the check runs (a safe-1271 check runs only the Safe checked).
  const members = check.kind === "safe-1271" ? [] : signatures.map((s) => s.signer);
  if (!(await pinnedCheck(check, members))) return "not-asked";
  const answer = (ok: boolean): FastAnswer => (ok ? "accepted" : "not-accepted");
  try {
    if (check.kind === "multisig") {
      const sorted = sortBySigner([...signatures]);
      const [result, present, profiles] = await Promise.all([
        aggregateAt(head, {
          target: check.contract,
          kind: "verdict",
          callData: encodeFunctionData({
            abi: guardiansAbi,
            functionName: "checkSignatures",
            args: [
              digest,
              sorted.map((s) => s.signer),
              sorted.map((s) => s.signature),
              BigInt(threshold),
            ],
          }),
        }),
        codeAt(check.contract, head),
        pinnedSafesAt(members, head),
      ]);
      noteAnswered();
      return answer(result.success && result.returnData === "0x" && present && profiles);
    }
    const signature =
      check.kind === "safe-1271"
        ? (signatures[0] as MemberSignature).signature
        : encodeMultisigSignature([...signatures]);
    const [result, profile] = await Promise.all([
      aggregateAt(head, {
        target: check.contract,
        kind: "verdict",
        callData: encodeFunctionData({
          abi: safeAbi,
          functionName: "isValidSignature",
          args: [digest, signature],
        }),
      }),
      check.kind === "safe-1271"
        ? pinnedSafeAt(check.contract, head)
        : pinnedSafesAt(members, head),
    ]);
    noteAnswered();
    return answer(result.success && isMagic(result.returnData) && profile);
  } catch (error) {
    noteFailed(error);
    return "not-accepted";
  }
}

/**
 * signedMessages(hash) from the head's aggregate on a pinned Safe 1.3.0, else null (ask directly).
 * Only a candidate: a non-zero value still has to pass the set's own check.
 */
export async function fastSignedMessages(
  safe: Address,
  messageHash: Hex,
  head: BlockRef
): Promise<bigint | null> {
  if (!enabled()) return null;
  const pins = await codePins().catch(() => null);
  if (!pins || !(await hasPinnedCode(safe, [pins.safeProxy]))) return null;
  try {
    const [result, profile] = await Promise.all([
      aggregateAt(head, {
        target: safe,
        callData: encodeFunctionData({
          abi: safeAbi,
          functionName: "signedMessages",
          args: [messageHash],
        }),
      }),
      pinnedSafeAt(safe, head),
    ]);
    noteAnswered();
    const value = wordOf(result);
    return value === null || !profile ? null : hexToBigInt(value);
  } catch (error) {
    noteFailed(error);
    return null;
  }
}
