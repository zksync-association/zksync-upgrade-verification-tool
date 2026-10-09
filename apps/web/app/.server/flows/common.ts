import { guardiansAbi, securityCouncilAbi } from "@/common/abis";
import type { Execution, MemberSignature } from "@/common/execution";
import {
  type AbiEvent,
  type Address,
  type Hex,
  decodeEventLog,
  decodeFunctionData,
  isAddressEqual,
  numberToHex,
  parseAbi,
  toEventSelector,
} from "viem";
import { cached } from "../cache";
import { UpstreamError, isFinalBlock } from "../chain/call";
import { RpcError } from "../chain/jsonrpc";
import { getLogs } from "../logs";
import { l1, lanes } from "../rpc";
import {
  type Freshness,
  type SignatureSet,
  type SignatureSetParams,
  type Simulation,
  type StreamedSet,
  firstSignatureSet,
  simulate,
  verifySignatureSet,
} from "../signatures";

export type SetState =
  | { status: "open" }
  | { status: "done"; detail: string; txHash: Hex | null }
  | { status: "closed"; detail: string };

export type ExecutionView = Execution & { simulation: Simulation };

/**
 * A signature set for a flow. "strict" (JSON): the strict result, once (`immediate` is `fresh`).
 * "page": the strict result is started first, and the page's first answer beside it (see
 * firstSignatureSet: a labelled stale set, or the strict result).
 */
export function streamSignatureSet(params: SignatureSetParams, freshness: Freshness): StreamedSet {
  const fresh = verifySignatureSet(params);
  if (freshness !== "page") return { immediate: fresh, fresh };
  const immediate = firstSignatureSet(params, fresh);
  // Callers attach their handlers to what they use; neither may go unhandled meanwhile.
  void immediate.catch(() => {});
  void fresh.catch(() => {});
  return { immediate, fresh };
}

/**
 * What a page shows first for something built from signature sets: the fresh value when every
 * first answer already is the strict result, else `stale()` (built from the first answers, with
 * nothing that would act on them, e.g. no execution).
 */
export async function firstOrFresh<T>(
  streamed: readonly StreamedSet[],
  fresh: Promise<T>,
  stale: (sets: SignatureSet[]) => T | Promise<T>
): Promise<T> {
  if (streamed.every((s) => s.immediate === s.fresh)) return fresh;
  const sets = await Promise.all(streamed.map((s) => s.immediate));
  return sets.some((set) => set.stale) ? stale(sets) : fresh;
}

/**
 * For a page loader: the fresh value to stream after a first answer that `isStale` says is stale;
 * null (nothing to send twice) when the first answer already is the fresh one.
 */
export async function freshAfter<T>(
  first: Promise<T>,
  fresh: Promise<T>,
  isStale: (first: T) => boolean
): Promise<T | null> {
  return isStale(await first) ? fresh : null;
}

/**
 * What the signature set adds up to on-chain right now: a ready transaction or why not. Its
 * simulation is kept per head unless it carries a signature the viewer supplied.
 */
export async function executionFor(
  set: SignatureSet,
  state: SetState,
  build: (valid: MemberSignature[]) => Execution | null
): Promise<ExecutionView | null> {
  if (state.status !== "open" || set.thresholdCheck.status !== "met") return null;
  const execution = build(set.valid);
  if (!execution) return null;
  const keep = set.members.every((m) => m.status !== "valid" || m.source !== "supplied");
  return { ...execution, simulation: await simulate(execution, { keep }) };
}

export function topicOf(abi: readonly unknown[], name: string): Hex {
  const event = (abi as AbiEvent[]).find((item) => item.type === "event" && item.name === name);
  if (!event) throw new Error(`No event ${name} in ABI`);
  return toEventSelector(event);
}

/** Logs of one event with the indexed id, decoded. */
export async function eventsWithId(
  address: Address,
  abi: readonly unknown[],
  name: string,
  id: Hex,
  fromBlock: bigint,
  toBlock?: bigint
) {
  const logs = await getLogs(l1, { address, topics: [topicOf(abi, name), id] }, fromBlock, toBlock);
  return logs.map((log) => ({
    log,
    event: decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics }) as unknown as {
      args: Record<string, unknown>;
    },
  }));
}

const execTransactionAbi = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

type SignedCall = { to: Address; data: Hex };

/**
 * The call a transaction made to `target`, also when wrapped in a Safe execTransaction (the
 * Security Council approval in 0x1defa4f7… was sent that way). Returns null for anything else.
 */
export async function callTo(txHash: Hex, target: Address): Promise<SignedCall | null> {
  return cached(`call-to:${txHash}:${target}`, Number.POSITIVE_INFINITY, async () => {
    const tx = await l1.getTransaction({ hash: txHash });
    if (tx.to && isAddressEqual(tx.to, target)) return { to: tx.to, data: tx.input };
    try {
      const { args } = decodeFunctionData({ abi: execTransactionAbi, data: tx.input });
      if (isAddressEqual(args[0], target)) return { to: args[0], data: args[2] };
    } catch {}
    return null;
  });
}

export type UsedSignature = MemberSignature & { matchesSafe: boolean | null };

/** Signers/signatures an executed approval passed to the contract, compared with Safe's copies. */
export function compareUsedSignatures(
  used: { signers: readonly Address[]; signatures: readonly Hex[] },
  set: SignatureSet
): UsedSignature[] {
  return used.signers.map((signer, i) => {
    const member = set.members.find((m) => isAddressEqual(m.member, signer));
    const signature = used.signatures[i] as Hex;
    const fromSafe = member?.source === "safe" ? member.signature : null;
    return {
      signer,
      signature,
      matchesSafe: fromSafe === null ? null : fromSafe.toLowerCase() === signature.toLowerCase(),
    };
  });
}

/** Decodes approve*(id, signers, signatures) / extendLegalVeto from SecurityCouncil or Guardians. */
export function decodeApprovalCall(data: Hex) {
  for (const abi of [securityCouncilAbi, guardiansAbi]) {
    try {
      const { functionName, args } = decodeFunctionData({ abi, data });
      if (
        functionName === "approveUpgradeSecurityCouncil" ||
        functionName === "approveUpgradeGuardians" ||
        functionName === "extendLegalVeto"
      ) {
        const [id, signers, signatures] = args as [Hex, readonly Address[], readonly Hex[]];
        return { functionName, id, signers, signatures };
      }
    } catch {}
  }
  return null;
}

// How a node says it keeps no state for a past block: geth "missing trie node …" and "historical
// state … is not available", Nethermind "No state available for block …", Besu "World state
// unavailable for block …", Erigon/reth "… pruned", Infura "… does not have access to archive
// state".
const NO_STATE =
  /missing trie node|state\b[^\n]{0,80}?\b(?:not available|unavailable|pruned)|no state (?:available|for)|\bpruned\b|archive/i;
// Or that it does not know the block at all. A load-balanced backend lagging the head says the
// same about a block it has not seen yet, so this is an answer only for a final block.
const NO_BLOCK = /header not found|unknown block|block not found/i;
// Internal error and limit exceeded mean "not now", whatever the text says.
const NOT_NOW = new Set([-32603, -32005]);

/**
 * True when the RPC can answer eth_call at a past block (needed to re-check executed signatures);
 * false only when the node says it keeps no state for that block. Any other failure (a rate limit,
 * a timeout, -32603, the network) rejects with UpstreamError and is not kept, so the caller shows
 * the check as not done, with the RPC error, and the next request asks again.
 */
export function hasArchiveState(address: Address, blockNumber: bigint): Promise<boolean> {
  return cached(`archive:${blockNumber}`, 10 * 60_000, async () => {
    try {
      await lanes().call.request("eth_getBalance", [address, numberToHex(blockNumber)]);
      return true;
    } catch (error) {
      if (error instanceof RpcError) {
        if (!NOT_NOW.has(error.code)) {
          const message = error.message.slice(0, 500);
          if (NO_STATE.test(message)) return false;
          if (NO_BLOCK.test(message) && (await isFinalBlock(blockNumber))) return false;
        }
        throw new UpstreamError(`${error.message} (JSON-RPC error ${error.code})`, {
          code: error.code,
          cause: error,
        });
      }
      // Lane errors are already scrubbed of the URL.
      throw new UpstreamError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
  });
}
