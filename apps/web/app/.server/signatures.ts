import { ERC1271_MAGIC_VALUE, guardiansAbi, safeAbi } from "@/common/abis";
import { type MemberSignature, encodeMultisigSignature, sortBySigner } from "@/common/execution";
import { memberLabel } from "@/common/labels";
import {
  type RecoveredOwner,
  type SafeMessageHashes,
  recoverSafeOwners,
  safeMessageHashes,
} from "@/common/safe";
import {
  type ActionName,
  type GovernanceHashes,
  type GovernanceTypedData,
  type SignerGroup,
  governanceHashes,
} from "@/common/typed-data";
import {
  type Address,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
  isAddressEqual,
  keccak256,
} from "viem";
import { FOREVER, cached, cachedUntil, concurrencyLimit, linkStore, peek } from "./cache";
import {
  type CallRequest,
  CallReverted,
  callFn,
  classify,
  ethCall,
  isFinalBlock,
  isUnknownBlock,
  requireCode,
} from "./chain/call";
import { type SafeInfo, safeInfo, safeInfoKey } from "./governance";
import { type BlockRef, latestBlock, network, rpcGeneration } from "./rpc";
import {
  type SafeMessageLookup,
  freshListingVersion,
  lookupSafeMessage,
  markSafeDemand,
  onSafeListingChange,
  peekSafeMessage,
} from "./safe/store";
import { SafeApiError, safeWalletUrl } from "./safe-api";

// The verification core. A signature counts only if the contract that will consume it accepts it in
// an eth_call: Multisig.checkSignatures for council/guardian members, and the Safe's own
// EIP-1271 isValidSignature for the ZK Foundation (exactly what EmergencyUpgradeBoard calls).
// The Safe Transaction Service is just one place to look for candidates.
//
// Every verdict read is a direct eth_call (chain/call.ts). Only a definite revert rejects; any
// other failure (an internal RPC error, out of gas, a rate limit, a timeout) fails the read, so it
// can never make a signature "invalid", a member "missing" or a threshold "rejected".
//
// On a live chain the verdicts are read at the head requests read (a memory hit while the sync
// engine runs), sent with its block number and kept under its HASH (contract code presence too):
// a block at the same height on another branch is another entry, and nothing read at 'latest'
// stands in for a head. (The node is asked by number: a load-balanced backend that holds another
// block at that height during a reorg can still answer for it, until the head moves on.) A whole
// set's result is kept per head too, while the Safe listings and Safe info it was computed from
// are still the ones served (listings at most 60 s old); a request that finds the set being
// computed takes that result only on the same terms, and otherwise computes it itself. Sets pages
// viewed in the last 10 minutes are computed again at each new head by the sync engine before the
// next request asks (see precomputeSignatureSets). Nothing involving a signature the viewer
// supplied (?sig=) is kept.

export type SignatureCheck =
  // SecurityCouncil / Guardians actions: checkSignatures(digest, signers, signatures, threshold)
  | { kind: "multisig"; contract: Address }
  // EmergencyUpgradeBoard → SecurityCouncil/Guardians.isValidSignature(digest, abi.encode(signers, sigs))
  | { kind: "multisig-1271"; contract: Address }
  // EmergencyUpgradeBoard → ZK Foundation Safe.isValidSignature(digest, signature)
  | { kind: "safe-1271"; contract: Address };

export type MemberStatus = "valid" | "invalid" | "collecting" | "missing" | "unavailable";
export type SignatureSource = "safe" | "onchain" | "supplied";

export type MemberResult = {
  member: Address;
  label: string | null;
  safe: SafeInfo;
  hashes: SafeMessageHashes | null;
  status: MemberStatus;
  source: SignatureSource | null;
  signature: Hex | null;
  owners: RecoveredOwner[];
  confirmations: number | null;
  signedAt: string | null;
  error: string | null;
  safeWalletUrl: string | null;
};

export type ThresholdCheck =
  | { status: "met"; checkedWith: string }
  | { status: "below"; valid: number; threshold: number }
  | { status: "rejected"; checkedWith: string; error: string };

export type SignatureSet = {
  action: ActionName;
  signerGroup: SignerGroup;
  typedData: GovernanceTypedData;
  hashes: GovernanceHashes;
  check: SignatureCheck;
  threshold: number;
  members: MemberResult[];
  valid: MemberSignature[];
  thresholdCheck: ThresholdCheck;
  safeApiError: string | null;
};

/**
 * True only for a definite revert (see chain/call.ts classify): the node answered with JSON-RPC
 * code 3, or -32000 "execution reverted" without out-of-gas text. Never for an RPC failure, and
 * never for a failed Multicall3 sub-call (it carries no error code). Kept for compatibility;
 * verdicts use chain/call.ts directly.
 */
export function isRevert(error: unknown): boolean {
  return classify(error) === "revert";
}

export function revertReason(error: unknown): string {
  if (error instanceof CallReverted) return error.reason;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.data?.errorName ?? reverted.shortMessage;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where verdicts are read:
 * - "head": the head requests read (live chains). Calls at its number, kept under its hash.
 * - "block": an explicit past block. Kept for good once that block is final.
 * - "latest": dev nodes, whose state can change in place without a new block. Kept a minute.
 */
type Pin =
  | { kind: "head"; head: BlockRef }
  | { kind: "block"; blockNumber: bigint }
  | { kind: "latest" };

const blockOf = (pin: Pin) =>
  pin.kind === "head" ? pin.head.number : pin.kind === "block" ? pin.blockNumber : undefined;

/** The block a read is sent for, and (at a head) the hash what it learns is kept under. */
const readAt = (pin: Pin) => ({
  blockNumber: blockOf(pin),
  blockHash: pin.kind === "head" ? pin.head.hash : undefined,
});

const pinKey = (pin: Pin) =>
  pin.kind === "head"
    ? `h:${pin.head.hash.toLowerCase()}`
    : pin.kind === "block"
      ? pin.blockNumber.toString()
      : "latest";

// At 'latest' (dev nodes) a verdict is kept a minute. Under a head's hash the entry is only asked
// for while that head is served; the time just bounds how long it stays in memory.
const VERDICT_TTL_MS = 60_000;
// A backend behind the one that named the head does not know it yet; the next one usually does.
const UNKNOWN_BLOCK_RETRY_MS = 300;

/**
 * A read pinned to the head, asked once more after a moment when the node says it does not know
 * the block (a load-balanced backend lagging the one that named it). A second such answer stays
 * what it is: an upstream error, never a verdict.
 */
async function pinned<T>(pin: Pin, read: () => Promise<T>): Promise<T> {
  if (pin.kind !== "head") return read();
  try {
    return await read();
  } catch (error) {
    if (!isUnknownBlock(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_BLOCK_RETRY_MS));
    return read();
  }
}

async function accepts(
  check: SignatureCheck,
  digest: Hex,
  signatures: MemberSignature[],
  threshold: number,
  pin: Pin
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { blockNumber, blockHash } = readAt(pin);
  try {
    if (check.kind === "multisig") {
      const sorted = sortBySigner(signatures);
      // checkSignatures returns nothing: callFn counts its success only where the contract has
      // code at that block (requireCode, one shared read per contract and block).
      await callFn({
        address: check.contract,
        abi: guardiansAbi,
        functionName: "checkSignatures",
        args: [
          digest,
          sorted.map((s) => s.signer),
          sorted.map((s) => s.signature),
          BigInt(threshold),
        ],
        blockNumber,
        blockHash,
      });
      return { ok: true };
    }
    const signature =
      check.kind === "safe-1271"
        ? signatures[0]?.signature ?? "0x"
        : encodeMultisigSignature(signatures);
    const [, result] = await Promise.all([
      requireCode(check.contract, blockNumber, blockHash),
      callFn<Hex>({
        address: check.contract,
        abi: safeAbi,
        functionName: "isValidSignature",
        args: [digest, signature],
        blockNumber,
      }),
    ]);
    return result === ERC1271_MAGIC_VALUE
      ? { ok: true }
      : { ok: false, error: `returned ${result}` };
  } catch (error) {
    // Only the contract's own revert rejects. An RPC failure must never read as "signature
    // invalid": let it fail the page instead.
    if (error instanceof CallReverted) return { ok: false, error: error.reason };
    throw error;
  }
}

// One member's signature checked alone. Multisig members go through checkSignatures with
// threshold 1, which also enforces membership. A signature the viewer supplied (?sig=) is checked
// afresh every time and its verdict kept nowhere, as AGENTS.md promises.
function acceptsOne(
  check: SignatureCheck,
  digest: Hex,
  signature: MemberSignature,
  source: SignatureSource,
  pin: Pin
) {
  const single: SignatureCheck =
    check.kind === "multisig-1271" ? { kind: "multisig", contract: check.contract } : check;
  const run = () => pinned(pin, () => accepts(single, digest, [signature], 1, pin));
  if (source === "supplied") return run();
  const key = `accepts:${single.kind}:${single.contract}:${digest}:${signature.signer}:${signature.signature}:${pinKey(pin)}`;
  if (pin.kind !== "block") return cached(key, VERDICT_TTL_MS, run);
  const { blockNumber } = pin;
  // At a past block: kept for good once that block is final.
  return cachedUntil(key, async () => {
    // The boundary is read before the check: a block at or below it was final when it was read.
    const final = await isFinalBlock(blockNumber);
    const value = await run();
    return { value, ttlMs: final ? FOREVER : VERDICT_TTL_MS };
  });
}

type Candidate = {
  source: SignatureSource;
  signature: Hex;
  confirmations?: number;
  signedAt?: string;
};

export type SignatureSetParams = {
  action: ActionName;
  signerGroup: SignerGroup;
  typedData: GovernanceTypedData;
  members: Address[];
  threshold: number;
  check: SignatureCheck;
  supplied?: MemberSignature[];
  /** A past block to check at (verdicts kept for good once it is final). Omitted: the head. */
  blockNumber?: bigint;
};

/** A set to verify, without supplied signatures, and the identity results are kept under. */
type SetSpec = Omit<SignatureSetParams, "supplied" | "blockNumber"> & { key: string };

function specOf(params: SignatureSetParams): SetSpec {
  const { action, signerGroup, typedData, members, threshold, check } = params;
  const key = [
    action,
    signerGroup,
    governanceHashes(typedData).digest,
    check.kind,
    check.contract.toLowerCase(),
    threshold,
    members.map((m) => m.toLowerCase()).join(","),
  ].join("|");
  return { action, signerGroup, typedData, members: [...members], threshold, check, key };
}

/**
 * Where a member Safe's message comes from: Safe (through the snapshot store) for a request, or
 * only a listing the store already holds for a precompute.
 */
type SafeSource = (member: Address, safeMessageHash: Hex) => Promise<SafeMessageLookup>;

/** A precompute that would need to ask Safe: left to the next request. Not a failure. */
class NeedsSafeRead extends Error {
  override name = "NeedsSafeRead";
}

const fromSafe: SafeSource = (member, hash) => lookupSafeMessage(member, hash);

const fromStore: SafeSource = async (member, hash) => {
  const found = peekSafeMessage(member, hash);
  if (!found) throw new NeedsSafeRead(`No listing at most 60 s old answers for ${member}`);
  return found;
};

type Computed = {
  set: SignatureSet;
  /** The listing version each member Safe's message came from (lower-case address). */
  listings: Map<string, number>;
  /** Some message was looked up by its hash (outside any listing version). */
  byHash: boolean;
  /** The cached Safe info read for each member: its cache key, and the entry's own promise. */
  infos: Map<string, Promise<SafeInfo>>;
};

export async function verifySignatureSet(params: SignatureSetParams): Promise<SignatureSet> {
  const supplied = params.supplied ?? [];
  if (params.blockNumber !== undefined) {
    const pin: Pin = { kind: "block", blockNumber: params.blockNumber };
    return (await computeSet(params, supplied, pin, fromSafe)).set;
  }
  const net = await network();
  if (net.isDevNode) return (await computeSet(params, supplied, { kind: "latest" }, fromSafe)).set;
  const head = await latestBlock();
  // Supplied signatures are checked afresh every time, and nothing about them is kept.
  if (supplied.length > 0)
    return (await computeSet(params, supplied, { kind: "head", head }, fromSafe)).set;
  const spec = specOf(params);
  watch(spec);
  return memoized(spec, head, false);
}

async function computeSet(
  params: Omit<SignatureSetParams, "supplied" | "blockNumber">,
  supplied: MemberSignature[],
  pin: Pin,
  source: SafeSource
): Promise<Computed> {
  const { chainId } = await network();
  const hashes = governanceHashes(params.typedData);
  let safeApiError: string | null = null;
  const listings = new Map<string, number>();
  let byHash = false;
  const infos = new Map<string, Promise<SafeInfo>>();

  const members = await Promise.all(
    params.members.map(async (member): Promise<MemberResult> => {
      // safeInfo() hands out the cache entry's own promise: while the cache still holds that
      // promise, the info this set was computed from is the info served.
      const infoRead = safeInfo(member);
      infos.set(safeInfoKey(member), infoRead);
      const [info, walletUrl] = await Promise.all([infoRead, safeWalletUrl(member)]);
      const memberHashes = info.isContract
        ? safeMessageHashes(chainId, member, hashes.digest)
        : null;
      const candidates: Candidate[] = supplied
        .filter((s) => isAddressEqual(s.signer, member))
        .map((s) => ({ source: "supplied", signature: s.signature }));

      let apiUnavailable = false;
      if (memberHashes) {
        try {
          const { message, version } = await source(member, memberHashes.safeMessageHash);
          if (version === null) byHash = true;
          else listings.set(member.toLowerCase(), version);
          if (message?.preparedSignature) {
            candidates.push({
              source: "safe",
              signature: message.preparedSignature,
              confirmations: message.confirmations.length,
              signedAt: message.created,
            });
          }
        } catch (error) {
          if (error instanceof NeedsSafeRead) throw error;
          apiUnavailable = true;
          safeApiError = error instanceof SafeApiError ? error.message : String(error);
        }
        // A Safe can also approve a message on-chain (SignMessageLib); the signature is then empty.
        if (!candidates.some((c) => c.source === "safe")) {
          const approved = await cached(
            `signed-messages:${member}:${memberHashes.safeMessageHash}:${pinKey(pin)}`,
            VERDICT_TTL_MS,
            () =>
              pinned(pin, () =>
                callFn<bigint>({
                  address: member,
                  abi: safeAbi,
                  functionName: "signedMessages",
                  args: [memberHashes.safeMessageHash],
                  ...readAt(pin),
                })
                  // A definite revert means "not approved"; an RPC failure must surface, not read
                  // as missing.
                  .catch((error: unknown) => {
                    if (error instanceof CallReverted) return 0n;
                    throw error;
                  })
              )
          );
          if (approved !== 0n) candidates.push({ source: "onchain", signature: "0x" });
        }
      }

      const base = {
        member,
        label: memberLabel(member),
        safe: info,
        hashes: memberHashes,
        safeWalletUrl: walletUrl,
      };
      let lastError: string | null = null;
      for (const candidate of candidates) {
        const result = await acceptsOne(
          params.check,
          hashes.digest,
          { signer: member, signature: candidate.signature },
          candidate.source,
          pin
        );
        if (result.ok) {
          return {
            ...base,
            status: "valid",
            source: candidate.source,
            signature: candidate.signature,
            owners: memberHashes
              ? await recoverSafeOwners(memberHashes.safeMessageHash, candidate.signature)
              : [],
            confirmations: candidate.confirmations ?? null,
            signedAt: candidate.signedAt ?? null,
            error: null,
          };
        }
        lastError = result.error;
      }

      const best = candidates.find((c) => c.source === "safe") ?? candidates[0];
      if (best) {
        const owners = memberHashes
          ? await recoverSafeOwners(memberHashes.safeMessageHash, best.signature)
          : [];
        const collecting =
          best.source === "safe" &&
          info.threshold !== null &&
          (best.confirmations ?? 0) < info.threshold;
        return {
          ...base,
          status: collecting ? "collecting" : "invalid",
          source: best.source,
          signature: best.signature,
          owners,
          confirmations: best.confirmations ?? null,
          signedAt: best.signedAt ?? null,
          error: lastError,
        };
      }
      return {
        ...base,
        status: apiUnavailable ? "unavailable" : "missing",
        source: null,
        signature: null,
        owners: [],
        confirmations: null,
        signedAt: null,
        error: null,
      };
    })
  );

  const valid = sortBySigner(
    members
      .filter((m) => m.status === "valid" && m.signature !== null)
      .map((m) => ({ signer: m.member, signature: m.signature as Hex }))
  );

  let thresholdCheck: ThresholdCheck;
  const checkedWith = describeCheck(params.check, params.threshold);
  if (valid.length < params.threshold) {
    thresholdCheck = { status: "below", valid: valid.length, threshold: params.threshold };
  } else {
    const run = () =>
      pinned(pin, () => accepts(params.check, hashes.digest, valid, params.threshold, pin));
    // Kept per head only when no signature in it was supplied; otherwise (and at 'latest' or a
    // past block) asked afresh every time.
    const keep =
      pin.kind === "head" && members.every((m) => m.status !== "valid" || m.source !== "supplied");
    const result = keep
      ? await cached(
          `accepts-set:${params.check.kind}:${params.check.contract}:${hashes.digest}:${params.threshold}:${valid.map((s) => `${s.signer}:${s.signature}`).join(",")}:${pinKey(pin)}`,
          VERDICT_TTL_MS,
          run
        )
      : await run();
    thresholdCheck = result.ok
      ? { status: "met", checkedWith }
      : { status: "rejected", checkedWith, error: result.error };
  }

  return {
    set: {
      action: params.action,
      signerGroup: params.signerGroup,
      typedData: params.typedData,
      hashes,
      check: params.check,
      threshold: params.threshold,
      members,
      valid,
      thresholdCheck,
      safeApiError,
    },
    listings,
    byHash,
    infos,
  };
}

// ---- results per head, and the sets pages are watching ----

type MemoEntry = {
  promise: Promise<Computed>;
  /** Once resolved and kept: what it computed. null while in flight. */
  kept: Computed | null;
  /** FOREVER while in flight. */
  expiresAt: number;
  /** Computed by a precompute (from held listings only). */
  background: boolean;
};

// A set's result at one head, while every listing and Safe info it came from is still the one
// served.
const memo = new Map<string, MemoEntry>();
const MEMO_TTL_MS = 60_000;
const MEMO_SWEEP_MS = 60_000;
let memoSweptAt = Date.now();

const memoKey = (spec: SetSpec, head: BlockRef) => `verify:${spec.key}:${head.hash.toLowerCase()}`;

/**
 * A computed set stands for what is served now: every member's message came from a listing
 * version (none looked up by hash, no Safe failure), each of those listings is still the one
 * served (so at most 60 s old), and each member's Safe info is still the cached entry it read.
 * Then computing it again at the same head would give the same set.
 */
function stands(computed: Computed): boolean {
  if (computed.byHash || computed.set.safeApiError !== null) return false;
  for (const [safe, version] of computed.listings)
    if (freshListingVersion(safe as Address) !== version) return false;
  for (const [key, info] of computed.infos) if (peek(key) !== info) return false;
  return true;
}

/** A kept result still stands: within its time, and for what is served now. */
function holds(entry: MemoEntry | undefined): entry is MemoEntry & { kept: Computed } {
  if (!entry?.kept || entry.expiresAt <= Date.now()) return false;
  return stands(entry.kept);
}

function sweepMemo() {
  const now = Date.now();
  if (now >= memoSweptAt && now - memoSweptAt < MEMO_SWEEP_MS) return;
  memoSweptAt = now;
  for (const [key, entry] of memo) if (entry.expiresAt <= now) memo.delete(key);
}

/**
 * The set at `head`: the result kept for it while that still stands, the computation in flight
 * for it (taken once it stands for what is served when it ends), or a new one. A request computes
 * with Safe's listings (read when older than 60 s); a precompute (`background`) only with listings
 * the store holds, and fails with NeedsSafeRead otherwise. A request that shared a precompute's
 * computation which failed computes on its own.
 */
async function memoized(spec: SetSpec, head: BlockRef, background: boolean): Promise<SignatureSet> {
  return (await resolveSet(spec, head, background)).set;
}

// Computations in flight one call may wait for before computing on its own: the one it found,
// and one another caller started when that one no longer stood.
const MAX_JOINS = 2;

/** memoized(), and whether this call computed the set (not a result kept or in flight). */
async function resolveSet(
  spec: SetSpec,
  head: BlockRef,
  background: boolean
): Promise<{ set: SignatureSet; computed: boolean }> {
  const key = memoKey(spec, head);
  for (let joins = 0; joins < MAX_JOINS; joins++) {
    const found = memo.get(key);
    if (holds(found)) return answered(found.kept, background);
    if (!found || found.kept !== null || found.expiresAt <= Date.now()) break;
    const shared = await found.promise.then(
      (computed) => ({ ok: true as const, computed }),
      (error: unknown) => ({ ok: false as const, error })
    );
    if (shared.ok) {
      // Taken only if it stands for what is served now: a listing it came from may have changed
      // or turned 60 s old, or a Safe's info been read again, while it was computed. Otherwise
      // this call reads them itself, as it would have without it.
      if (stands(shared.computed)) return answered(shared.computed, background);
    } else if (background || !found.background) {
      throw shared.error;
    }
  }
  const computed = await compute(key, spec, head, background);
  return { set: computed.set, computed: true };
}

function answered(computed: Computed, background: boolean) {
  // A page answered from these listings: the sweep keeps them fresh as if it had read them.
  if (!background) markSafeDemand(computed.listings.keys());
  return { set: computed.set, computed: false };
}

function compute(
  key: string,
  spec: SetSpec,
  head: BlockRef,
  background: boolean
): Promise<Computed> {
  const computed = computeSet(spec, [], { kind: "head", head }, background ? fromStore : fromSafe);
  const entry: MemoEntry = { promise: computed, kept: null, expiresAt: FOREVER, background };
  sweepMemo();
  memo.set(key, entry);
  // Registered before anyone else can wait on it, so callers that joined it see the outcome.
  computed.then(
    (result) => {
      // Dropped meanwhile (settings change, refresh): never put back.
      if (memo.get(key) !== entry) return;
      // Kept only when every message came from a listing version (a lookup by hash or a Safe
      // failure has no version to tell when it no longer stands).
      if (result.byHash || result.set.safeApiError !== null) {
        memo.delete(key);
        return;
      }
      entry.kept = result;
      entry.expiresAt = Date.now() + MEMO_TTL_MS;
    },
    () => {
      if (memo.get(key) === entry) memo.delete(key);
    }
  );
  return computed;
}

// The sets pages verified (without supplied signatures) in the last 10 minutes, most recent last.
const WATCH_LIMIT = 64;
const WATCH_FOR_MS = 10 * 60_000;
const watched = new Map<string, { spec: SetSpec; viewedAt: number }>();

function watch(spec: SetSpec) {
  watched.delete(spec.key);
  watched.set(spec.key, { spec, viewedAt: Date.now() });
  while (watched.size > WATCH_LIMIT) {
    const oldest = watched.keys().next().value as string;
    watched.delete(oldest);
  }
}

function watchedSpecs(): SetSpec[] {
  const now = Date.now();
  const specs: SetSpec[] = [];
  for (const [key, { spec, viewedAt }] of watched) {
    if (now - viewedAt > WATCH_FOR_MS) watched.delete(key);
    else specs.push(spec);
  }
  return specs;
}

/** How many watched sets a precompute verifies at once (each is one POST of eth_calls or so). */
const PRECOMPUTE_CONCURRENCY = 4;

export type PrecomputeRun = {
  block: string;
  /** "head": a new head; "safe": a member Safe's listing changed. */
  trigger: "head" | "safe";
  /** Watched sets considered. */
  sets: number;
  /** Verified now. */
  verified: number;
  /** Already verified (or being verified) at this head from the listings served now. */
  reused: number;
  /** Left to the next request: it needs Safe (no listing at most 60 s old), or settings changed. */
  skipped: number;
  /** An upstream error: nothing kept, the next request verifies on its own. */
  failed: number;
  ms: number;
};

let lastRun: PrecomputeRun | null = null;

// settings changes and dev-node refreshes (clearCache) drop kept results and watched sets alike;
// an invalidate() covering "verify:" drops the results.
linkStore("verify:", (prefix) => {
  memo.clear();
  if (prefix === null) {
    watched.clear();
    lastRun = null;
  }
});

/**
 * Verifies at `head` the sets pages viewed in the last 10 minutes (only those with a member in
 * `safes`, when given), so the next request at that head finds them. Only Safe listings the store
 * holds (at most 60 s old) are used; a set that would need Safe is left to the request. Never
 * rejects; failures leave nothing kept.
 */
export async function precomputeSignatureSets(
  head: BlockRef,
  options: { current?: () => boolean; safes?: ReadonlySet<string> } = {}
): Promise<PrecomputeRun> {
  const started = Date.now();
  const current = options.current ?? (() => true);
  const safes = options.safes;
  const specs = watchedSpecs().filter(
    (spec) => !safes || spec.members.some((m) => safes.has(m.toLowerCase()))
  );
  const run: PrecomputeRun = {
    block: head.number.toString(),
    trigger: safes ? "safe" : "head",
    sets: specs.length,
    verified: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
    ms: 0,
  };
  const limit = concurrencyLimit(PRECOMPUTE_CONCURRENCY);
  await Promise.all(
    specs.map((spec) =>
      limit(async () => {
        if (!current()) {
          run.skipped++;
          return;
        }
        try {
          const { computed } = await resolveSet(spec, head, true);
          if (computed) run.verified++;
          else run.reused++;
        } catch (error) {
          if (error instanceof NeedsSafeRead) run.skipped++;
          else run.failed++;
        }
      })
    )
  );
  run.ms = Date.now() - started;
  if (current()) lastRun = run;
  return run;
}

/** Drives re-verification when a watched member Safe's listing changes (the sync engine). */
export type SignatureWatchDriver = {
  /** The engine is following the chain (the app is in use). */
  active: () => boolean;
  /** The head requests read now, without asking the node; null when none is cached. */
  head: () => Promise<BlockRef> | null;
};

let driver: SignatureWatchDriver | null = null;
let unsubscribe: (() => void) | null = null;
const changed = new Set<string>();
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let rechecking = false;
// Listing reads land in waves (a page's Safes, a sweep's): one re-verification for a wave.
const CHANGE_SETTLE_MS = 100;

/**
 * While `next.active()`, a watched set is verified again at the served head whenever the listing
 * of one of its member Safes is stored with a new version. Idempotent.
 */
export function startSignatureWatch(next: SignatureWatchDriver) {
  driver = next;
  unsubscribe ??= onSafeListingChange(noteListingChange);
}

export function stopSignatureWatch() {
  driver = null;
  unsubscribe?.();
  unsubscribe = null;
  changed.clear();
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = null;
}

function noteListingChange(safe: Address) {
  if (!driver?.active()) return;
  const key = safe.toLowerCase();
  let wanted = false;
  for (const { spec } of watched.values())
    if (spec.members.some((m) => m.toLowerCase() === key)) wanted = true;
  if (!wanted) return;
  changed.add(key);
  scheduleRecheck();
}

function scheduleRecheck() {
  if (changeTimer !== null || rechecking) return;
  const timer = setTimeout(() => void recheckChanged(), CHANGE_SETTLE_MS);
  (timer as { unref?: () => void }).unref?.();
  changeTimer = timer;
}

async function recheckChanged() {
  changeTimer = null;
  const current = driver;
  const safes = new Set(changed);
  changed.clear();
  if (!current?.active() || safes.size === 0) return;
  const head = current.head();
  if (!head) return;
  rechecking = true;
  const generation = rpcGeneration();
  try {
    await precomputeSignatureSets(await head, {
      safes,
      current: () => rpcGeneration() === generation && current === driver && current.active(),
    });
  } catch {
    // No head to verify at (its read failed): the next tick or request verifies.
  } finally {
    rechecking = false;
    if (changed.size > 0) scheduleRecheck();
  }
}

export type SignatureSetsStatus = {
  /** Sets pages verified in the last 10 minutes (without supplied signatures), at most 64. */
  watched: number;
  /** The last precompute: its block, what it did, how long it took. */
  lastRun: PrecomputeRun | null;
};

/** What the precompute does, for /api/status. */
export function signatureSetsStatus(): SignatureSetsStatus {
  return { watched: watchedSpecs().length, lastRun: lastRun && { ...lastRun } };
}

function describeCheck(check: SignatureCheck, threshold: number) {
  switch (check.kind) {
    case "multisig":
      return `checkSignatures(digest, signers, signatures, ${threshold}) on ${check.contract}`;
    case "multisig-1271":
      return `isValidSignature(digest, abi.encode(signers, signatures)) on ${check.contract}`;
    case "safe-1271":
      return `isValidSignature(digest, signature) on Safe ${check.contract}`;
  }
}

export type Simulation =
  | { status: "ok" }
  | { status: "reverted"; error: string }
  | { status: "skipped"; reason: string };

// A funded stand-in sender, so payable calls (the L2 veto forwards txMintValue) can be simulated.
const SIMULATION_SENDER: Address = "0x000000000000000000000000000000000000dEaD";

export type SimulateOptions = {
  /**
   * The transaction carries no signature the viewer supplied (?sig=). On a live chain it is then
   * simulated at the head requests read and the answer kept under that head's hash, as verdicts
   * are: requests at one head ask the node once. Otherwise, and on a dev node, it is asked at
   * 'latest' every time, and nothing about it is kept.
   */
  keep?: boolean;
};

/** eth_call of the execution transaction against the latest state. Nothing is sent. */
export async function simulate(
  execution: {
    to: Address;
    data: Hex;
    value: string;
  },
  options: SimulateOptions = {}
): Promise<Simulation> {
  const value = BigInt(execution.value);
  return simulateCall(
    {
      from: SIMULATION_SENDER,
      to: execution.to,
      data: execution.data,
      value,
      stateOverride:
        value > 0n ? [{ address: SIMULATION_SENDER, balance: value + 10n ** 18n }] : undefined,
    },
    options
  );
}

/**
 * eth_call of a transaction. "reverted" only for a definite revert; any other failure is
 * "skipped", never a verdict on the transaction, and never kept.
 */
export async function simulateCall(
  request: CallRequest,
  { keep = false }: SimulateOptions = {}
): Promise<Simulation> {
  if (keep && request.blockNumber === undefined) {
    let head: BlockRef | null;
    try {
      head = (await network()).isDevNode ? null : await latestBlock();
    } catch (error) {
      return skipped(error);
    }
    if (head) return simulateAtHead(request, head);
  }
  return simulateAt(request);
}

function simulateAtHead(request: CallRequest, head: BlockRef): Promise<Simulation> {
  const pin: Pin = { kind: "head", head };
  const overrides = (request.stateOverride ?? [])
    .map(({ address, balance }) => `${address.toLowerCase()}=${balance}`)
    .join(",");
  const key = [
    "simulate",
    request.from?.toLowerCase() ?? "",
    request.to.toLowerCase(),
    request.value ?? 0n,
    keccak256(request.data),
    overrides,
    pinKey(pin),
  ].join(":");
  return cachedUntil(key, async () => {
    const value = await simulateAt(request, pin);
    return { value, ttlMs: value.status === "skipped" ? 0 : VERDICT_TTL_MS };
  });
}

async function simulateAt(request: CallRequest, pin?: Pin): Promise<Simulation> {
  try {
    if (pin) await pinned(pin, () => ethCall({ ...request, blockNumber: blockOf(pin) }));
    else await ethCall(request);
    return { status: "ok" };
  } catch (error) {
    return error instanceof CallReverted
      ? { status: "reverted", error: error.reason }
      : skipped(error);
  }
}

function skipped(error: unknown): Simulation {
  return {
    status: "skipped",
    reason: `RPC error: ${error instanceof Error ? error.message : String(error)}`,
  };
}
