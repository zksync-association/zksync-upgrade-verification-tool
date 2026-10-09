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
import { createHash } from "node:crypto";
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
import {
  type FastAnswer,
  type VerdictCounts,
  fastAccepts,
  fastSignedMessages,
  noteVerdict,
  verdictCounts,
} from "./chain/verdicts";
import { type SafeInfo, safeInfo, safeInfoKey } from "./governance";
import {
  type BlockRef,
  latestBlock,
  network,
  rpcGeneration,
  servedHead,
  servedHeadNow,
} from "./rpc";
import {
  SAFE_LISTING_MAX_AGE_MS,
  type SafeCheck,
  type SafeMessageLookup,
  type SafeSnapshot,
  answerFromListing,
  freshListingVersion,
  heldSafeListing,
  listSafeMessages,
  lookupSafeMessage,
  nudgeSafeWatch,
  onSafeListingChange,
  pageSafeListing,
  peekHeldSafeMessage,
  safeCheckOf,
} from "./safe/store";
import { SafeApiError, safeCooldownError, safeWalletUrl } from "./safe-api";
import { asEngineWork, requestJoinsEngineWork } from "./sync/pacer";
import { type WatchItem, onPageLoad, presence } from "./sync/presence";
import { noteContent, touchRev } from "./sync/revs";

// The verification core. A signature counts only if the contract that will consume it accepts it in
// an eth_call: Multisig.checkSignatures for council/guardian members, and the Safe's own
// EIP-1271 isValidSignature for the ZK Foundation (exactly what EmergencyUpgradeBoard calls).
// The Safe Transaction Service is just one place to look for candidates.
//
// At a head a check is first asked in the head's aggregate3, which only supplies positives
// (chain/verdicts.ts); everything else is a direct eth_call, where only a definite revert rejects:
// an RPC failure never makes a signature "invalid", a member "missing" or a threshold "rejected".
// Verdicts are read at the head's number and kept under its HASH; nothing about a signature the
// viewer supplied (?sig=) is kept. A page may first show an older result, labelled, and verifies
// from Safe copies under the page rule; JSON only ever gets the strict result.

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
  verifiedAtBlock?: string | null;
  safeFetchedAt?: string | null;
  /** true only on a page's labelled first answer; JSON is always strict (false). */
  stale?: boolean;
  reverifyingAt?: string | null;
  watch?: WatchItem;
  safeCheck?: SafeCheck | null;
};

/** "strict" (JSON): copies at most 60 s old, verdicts at the head; "page": a first answer first. */
export type Freshness = "strict" | "page";

export type StreamedSet = {
  immediate: Promise<SignatureSet>;
  fresh: Promise<SignatureSet>;
};

/** A definite revert only (chain/call.ts classify), never an RPC failure. */
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

// Where verdicts are read: "head" (live chains: at its number, kept under its hash), "block" (a
// past block: kept for good once final), "latest" (dev nodes, which change in place: a minute).
type Pin =
  | { kind: "head"; head: BlockRef }
  | { kind: "block"; blockNumber: bigint }
  | { kind: "latest" };

const blockOf = (pin: Pin) =>
  pin.kind === "head" ? pin.head.number : pin.kind === "block" ? pin.blockNumber : undefined;

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

// At 'latest' a verdict is kept a minute; under a head's hash the time only bounds memory.
const VERDICT_TTL_MS = 60_000;
// A backend behind the one that named the head does not know it yet; the next one usually does.
const UNKNOWN_BLOCK_RETRY_MS = 300;

/** Asked once more when the node does not know the block yet; a second such answer is an error. */
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
      // checkSignatures returns nothing: its success counts only where the contract has code at
      // that block (requireCode).
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

/** At a head: the aggregate's positive when it gives one, else `direct`, which alone can reject. */
async function fastThenDirect(
  check: SignatureCheck,
  digest: Hex,
  signatures: MemberSignature[],
  threshold: number,
  pin: Pin,
  direct: () => Promise<{ ok: true } | { ok: false; error: string }>,
  guess?: Promise<FastAnswer>
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (pin.kind !== "head") {
    noteVerdict(blockOf(pin), "direct");
    return direct();
  }
  const fast = await (guess ?? fastAccepts(check, digest, signatures, threshold, pin.head));
  if (fast === "accepted") {
    noteVerdict(pin.head.number, "fast");
    return { ok: true };
  }
  noteVerdict(pin.head.number, fast === "not-asked" ? "direct" : "reasked");
  return direct();
}

// One member's signature checked alone; multisig members with threshold 1, which also enforces
// membership. A supplied signature (?sig=) is checked afresh every time and kept nowhere.
function acceptsOne(
  check: SignatureCheck,
  digest: Hex,
  signature: MemberSignature,
  source: SignatureSource,
  pin: Pin
) {
  const single: SignatureCheck =
    check.kind === "multisig-1271" ? { kind: "multisig", contract: check.contract } : check;
  const direct = () => pinned(pin, () => accepts(single, digest, [signature], 1, pin));
  if (source === "supplied") {
    noteVerdict(blockOf(pin), "direct");
    return direct();
  }
  const run = () => fastThenDirect(single, digest, [signature], 1, pin, direct);
  const key = `accepts:${single.kind}:${single.contract}:${digest}:${signature.signer}:${signature.signature}:${pinKey(pin)}`;
  if (pin.kind !== "block") return cached(key, VERDICT_TTL_MS, run);
  const { blockNumber } = pin;
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
  blockNumber?: bigint;
  open?: boolean;
  /** With `open`: when it can no longer be signed (a freeze request's validUntil, Unix seconds). */
  openUntil?: bigint;
};

type SetSpec = Omit<SignatureSetParams, "supplied" | "blockNumber" | "open" | "openUntil"> & {
  key: string;
};

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

type SafeSource = (member: Address, safeMessageHash: Hex) => Promise<SafeMessageLookup>;

/** A precompute that would need to ask Safe: left to the next request. Not a failure. */
class NeedsSafeRead extends Error {
  override name = "NeedsSafeRead";
}

const fromSafe: SafeSource = (member, hash) => lookupSafeMessage(member, hash);

/** A page's first answer: the listing held, whatever its age (never asks Safe). */
const fromHeld: SafeSource = async (member, hash) => {
  const found = peekHeldSafeMessage(member, hash);
  if (!found) throw new NeedsSafeRead(`No listing held answers for ${member}`);
  return found;
};

type Computed = {
  set: SignatureSet;
  listings: Map<string, number>;
  byHash: boolean;
  infos: Map<string, Promise<SafeInfo>>;
  /** Some message came from a copy older than 60 s when used, or read by the last run. */
  staleCopies: boolean;
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
  return memoized(specOf(params), head);
}

/** Starts reading the listings a request will need once something else is read. Never rejects. */
export function prefetchSafeListings(
  members: readonly Address[],
  { page = false }: { page?: boolean } = {}
) {
  for (const member of new Map(members.map((m) => [m.toLowerCase(), m])).values()) {
    // A page reads only Safes it holds no copy of: any other copy may serve it under the page rule.
    if (page) {
      const held = heldSafeListing(member);
      if (held && !held.fromLastRun) continue;
    }
    void safeInfo(member)
      .then((info) => (info.isContract ? listSafeMessages(member) : null))
      .catch(() => {});
  }
}

async function computeSet(
  params: Omit<SignatureSetParams, "supplied" | "blockNumber" | "open" | "openUntil">,
  supplied: MemberSignature[],
  pin: Pin,
  source: SafeSource,
  guess?: readonly MemberSignature[]
): Promise<Computed> {
  const { chainId } = await network();
  const hashes = governanceHashes(params.typedData);
  // At a head the threshold check is asked in the same aggregate as the members', with the last
  // valid set as a guess: its answer is taken when the members give that same set.
  const guessed =
    pin.kind === "head" &&
    supplied.length === 0 &&
    guess !== undefined &&
    guess.length >= params.threshold &&
    guess.length > 0
      ? sortBySigner([...guess])
      : null;
  const guessAnswer = guessed
    ? fastAccepts(
        params.check,
        hashes.digest,
        guessed,
        params.threshold,
        (pin as { head: BlockRef }).head
      )
    : null;
  let safeApiError: string | null = null;
  const listings = new Map<string, number>();
  let byHash = false;
  const infos = new Map<string, Promise<SafeInfo>>();
  let oldestCopy: number | null = null;
  let staleCopies = false;

  const members = await Promise.all(
    params.members.map(async (member): Promise<MemberResult> => {
      // safeInfo() hands out the cache entry's own promise: `stands` compares it with the served.
      const infoRead = safeInfo(member, pin.kind === "head" ? pin.head : undefined);
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
          const lookup = await source(member, memberHashes.safeMessageHash);
          const { message, version } = lookup;
          if (version === null) byHash = true;
          else listings.set(member.toLowerCase(), version);
          const copiedAt = lookup.fetchedAt ?? Date.now();
          if (oldestCopy === null || copiedAt < oldestCopy) oldestCopy = copiedAt;
          // A copy the last run read (kept on disk) is stale whatever its age.
          if (lookup.fromLastRun || Date.now() - copiedAt > SAFE_LISTING_MAX_AGE_MS)
            staleCopies = true;
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
            async () => {
              const fast =
                pin.kind === "head"
                  ? await fastSignedMessages(member, memberHashes.safeMessageHash, pin.head)
                  : null;
              if (fast !== null) return fast;
              return pinned(pin, () =>
                callFn<bigint>({
                  address: member,
                  abi: safeAbi,
                  functionName: "signedMessages",
                  args: [memberHashes.safeMessageHash],
                  ...readAt(pin),
                })
                  // A definite revert means "not approved"; an RPC failure must surface.
                  .catch((error: unknown) => {
                    if (error instanceof CallReverted) return 0n;
                    throw error;
                  })
              );
            }
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
    const direct = () =>
      pinned(pin, () => accepts(params.check, hashes.digest, valid, params.threshold, pin));
    const sameAsGuess =
      guessed !== null &&
      guessed.length === valid.length &&
      guessed.every(
        (g, i) =>
          isAddressEqual(g.signer, (valid[i] as MemberSignature).signer) &&
          g.signature.toLowerCase() === (valid[i] as MemberSignature).signature.toLowerCase()
      );
    const anySupplied = members.some((m) => m.status === "valid" && m.source === "supplied");
    const run = () =>
      anySupplied
        ? direct()
        : fastThenDirect(
            params.check,
            hashes.digest,
            valid,
            params.threshold,
            pin,
            direct,
            sameAsGuess && guessAnswer ? guessAnswer : undefined
          );
    // Kept per head only when no signature in it was supplied.
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
      verifiedAtBlock: blockOf(pin)?.toString() ?? null,
      safeFetchedAt: oldestCopy === null ? null : new Date(oldestCopy).toISOString(),
      stale: false,
    },
    listings,
    byHash,
    infos,
    staleCopies,
  };
}

// ---- results per head, and the sets pages are watching ----

type MemoEntry = {
  promise: Promise<Computed>;
  kept: Computed | null;
  expiresAt: number;
};

// JSON's result per head, while every listing and Safe info it came from is still the one served.
const memo = new Map<string, MemoEntry>();
const MEMO_TTL_MS = 60_000;
const MEMO_SWEEP_MS = 60_000;
let memoSweptAt = Date.now();

const memoKey = (spec: SetSpec, head: BlockRef) => `verify:${spec.key}:${head.hash.toLowerCase()}`;

/**
 * A computed set stands for what is served now: every message from a listing version still served
 * (at most 60 s old), each member's Safe info still the cached entry, nothing looked up by hash or
 * taken from an older copy (`staleCopies`: an unchanged re-read keeps a listing's version).
 */
function stands(computed: Computed): boolean {
  if (computed.byHash || computed.set.safeApiError !== null || computed.staleCopies) return false;
  const copiedAt = computed.set.safeFetchedAt;
  if (copiedAt && Date.now() - Date.parse(copiedAt) > SAFE_LISTING_MAX_AGE_MS) return false;
  for (const [safe, version] of computed.listings)
    if (freshListingVersion(safe as Address) !== version) return false;
  for (const [key, info] of computed.infos) if (peek(key) !== info) return false;
  return true;
}

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

/** JSON's set at `head`: kept, in flight (a page's too, once it stands), or computed now. */
async function memoized(spec: SetSpec, head: BlockRef): Promise<SignatureSet> {
  return (await resolveSet(spec, head)).set;
}

const MAX_JOINS = 2;

async function resolveSet(
  spec: SetSpec,
  head: BlockRef
): Promise<{ set: SignatureSet; computed: boolean }> {
  const key = memoKey(spec, head);
  for (let joins = 0; joins < MAX_JOINS; joins++) {
    const found = memo.get(key);
    if (holds(found)) return answered(found.kept);
    const page = found ? null : pageInFlight(spec, head);
    const inFlight =
      found && found.kept === null && found.expiresAt > Date.now()
        ? found.promise
        : page?.promise ?? null;
    if (!inFlight) break;
    // A request waiting on the engine's computation: the engine's paced reads go now.
    if (page?.engine) requestJoinsEngineWork(inFlight);
    const shared = await inFlight.then(
      (computed) => ({ ok: true as const, computed }),
      (error: unknown) => ({ ok: false as const, error })
    );
    if (shared.ok) {
      // Taken only if it still stands: a listing or Safe info may have changed meanwhile.
      if (stands(shared.computed)) return answered(shared.computed);
    } else if (found) {
      throw shared.error;
    }
  }
  const computed = await compute(key, spec, head);
  return { set: computed.set, computed: true };
}

function answered(computed: Computed) {
  return { set: computed.set, computed: false };
}

function compute(key: string, spec: SetSpec, head: BlockRef): Promise<Computed> {
  const guess = lastResults.get(spec.key)?.set.valid;
  const computed = computeSet(spec, [], { kind: "head", head }, fromSafe, guess);
  const entry: MemoEntry = { promise: computed, kept: null, expiresAt: FOREVER };
  sweepMemo();
  memo.set(key, entry);
  // Registered before anyone else can wait on it, so callers that joined it see the outcome.
  computed.then(
    (result) => {
      if (memo.get(key) !== entry) return;
      remember(spec, head.number, result);
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

// ---- a page's result (pages only; never read for JSON) ----

/** "request" reads Safe for a copy outside the page rule; "engine" never asks Safe. */
type PageReader = "request" | "engine";

/**
 * A copy under the page rule; for a closed set any copy held; for an open one any copy held,
 * provisionally (used only when valid from it at the head). Otherwise Safe is read (a request) or
 * the set is left to the next request (the engine). Never a copy the last run read.
 */
function pageSource(open: boolean, reader: PageReader, strict: ReadonlySet<string> = new Set()) {
  const provisional = new Set<string>();
  const held = (member: Address): SafeSnapshot | null => {
    const listing = heldSafeListing(member);
    return listing && !listing.fromLastRun ? listing : null;
  };
  const source: SafeSource = async (member, hash) => {
    const key = member.toLowerCase();
    if (!strict.has(key)) {
      const listing = pageSafeListing(member, "set") ?? (open ? null : held(member));
      const answer = listing ? answerFromListing(listing, hash) : null;
      if (answer) return answer;
      if (!listing && open) {
        const any = held(member);
        const early = any ? answerFromListing(any, hash) : null;
        if (early) {
          provisional.add(key);
          return early;
        }
      }
    }
    if (reader === "engine") {
      // During a Safe cooldown a request would fail the same way without asking: the engine
      // gives its result (the member unavailable, never missing).
      const cooling = safeCooldownError();
      if (cooling) throw cooling;
      throw new NeedsSafeRead(`No copy under the page rule for ${member}`);
    }
    return lookupSafeMessage(member, hash);
  };
  return { source, provisional };
}

/** Members not valid from a provisional copy are computed again from Safe (by a request). */
async function computePage(
  spec: SetSpec,
  head: BlockRef,
  open: boolean,
  reader: PageReader
): Promise<Computed> {
  const guess = lastResults.get(spec.key)?.set.valid;
  const pin: Pin = { kind: "head", head };
  const first = pageSource(open, reader);
  const computed = await computeSet(spec, [], pin, first.source, guess);
  const redo = new Set(
    [...first.provisional].filter(
      (key) => computed.set.members.find((m) => m.member.toLowerCase() === key)?.status !== "valid"
    )
  );
  if (redo.size === 0) return computed;
  if (reader === "engine" && !safeCooldownError()) {
    recheckMembers(spec, head, redo);
    throw new NeedsSafeRead("A member's older copy no longer counts");
  }
  return computeSet(spec, [], pin, pageSource(open, reader, redo).source, guess);
}

// Members of an open set the engine found not valid from copies the page rule no longer covers:
// watched at once, until a result at that head or a later one says what they are.
type Recheck = { members: Map<string, Address>; block: bigint };
const rechecks = new Map<string, Recheck>();

/**
 * Watches these members' Safes now; when the shown result has one of them valid, its revision
 * changes at once, so a page showing it reloads.
 */
function recheckMembers(spec: SetSpec, head: BlockRef, redo: ReadonlySet<string>) {
  const entry = rechecks.get(spec.key) ?? {
    members: new Map<string, Address>(),
    block: head.number,
  };
  if (head.number > entry.block) entry.block = head.number;
  let added = false;
  for (const member of spec.members) {
    const key = member.toLowerCase();
    if (!redo.has(key) || entry.members.has(key)) continue;
    entry.members.set(key, member);
    added = true;
  }
  rechecks.delete(spec.key);
  rechecks.set(spec.key, entry);
  while (rechecks.size > PAGE_SETS_LIMIT) rechecks.delete(rechecks.keys().next().value as string);
  const shown = lastResults.get(spec.key)?.set;
  if (shown?.members.some((m) => m.status === "valid" && redo.has(m.member.toLowerCase())))
    touchRev(setKeyOf(spec));
  if (added) nudgeSafeWatch();
}

function watchedMembersOf(spec: SetSpec): Address[] {
  const latest = lastResults.get(spec.key)?.set;
  const members = latest ? notValid(spec, latest) : [...spec.members];
  for (const member of rechecks.get(spec.key)?.members.values() ?? [])
    if (!members.some((m) => isAddressEqual(m, member))) members.push(member);
  return members;
}

/**
 * A kept page result stands for what is held now: the same listing versions (never the last
 * run's), still under the page rule, no lookup by hash or Safe failure, the same Safe info.
 */
function standsForPage(computed: Computed, open: boolean): boolean {
  if (computed.byHash || computed.set.safeApiError !== null) return false;
  for (const [safe, version] of computed.listings) {
    const listing = heldSafeListing(safe as Address);
    if (!listing || listing.fromLastRun || listing.version !== version) return false;
    if (!open) continue;
    const member = computed.set.members.find((m) => m.member.toLowerCase() === safe);
    if (member?.status === "valid") continue;
    if (!pageSafeListing(safe as Address, "set")) return false;
  }
  for (const [key, info] of computed.infos) if (peek(key) !== info) return false;
  return true;
}

type PageEntry = {
  promise: Promise<Computed>;
  kept: Computed | null;
  expiresAt: number;
  engine: boolean;
};

// A page's result per head, never read for JSON; `open` is in the key: the page rule depends on it.
const pageMemo = new Map<string, PageEntry>();

const pageMemoKey = (spec: SetSpec, head: BlockRef, open: boolean) =>
  `verify-page:${open ? "open" : "done"}:${spec.key}:${head.hash.toLowerCase()}`;

function sweepPageMemo() {
  const now = Date.now();
  for (const [key, entry] of pageMemo) if (entry.expiresAt <= now) pageMemo.delete(key);
}

const orderOf = (computed: Computed) => Math.max(0, ...computed.listings.values());

function pageAnswer(
  spec: SetSpec,
  head: BlockRef,
  open: boolean,
  computed: Computed
): SignatureSet {
  let oldest: number | null = null;
  for (const safe of computed.listings.keys()) {
    const at = heldSafeListing(safe as Address)?.fetchedAt;
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at;
  }
  const watch = noteContent(
    setKeyOf(spec),
    { head: head.number, order: orderOf(computed) },
    setContent(computed.set)
  );
  return {
    ...computed.set,
    safeFetchedAt: oldest === null ? computed.set.safeFetchedAt : new Date(oldest).toISOString(),
    stale: false,
    watch,
    safeCheck: open ? watchedCheck(spec, computed.set) : null,
  };
}

function notValid(spec: SetSpec, set: SignatureSet): Address[] {
  return spec.members.filter(
    (member) => set.members.find((m) => isAddressEqual(m.member, member))?.status !== "valid"
  );
}

function watchedCheck(spec: SetSpec, set: SignatureSet): SafeCheck | null {
  const members = notValid(spec, set);
  return members.length > 0 ? safeCheckOf(members) : null;
}

/** A set's revision digests what the page shows but the labels, which change at every head. */
export function setContent(set: SignatureSet) {
  return {
    action: set.action,
    signerGroup: set.signerGroup,
    digest: set.hashes.digest,
    check: set.check,
    threshold: set.threshold,
    members: set.members.map((m) => ({
      member: m.member,
      status: m.status,
      source: m.source,
      signature: m.signature,
      confirmations: m.confirmations,
      signedAt: m.signedAt,
      error: m.error,
      owners: m.owners,
      safe: m.safe,
    })),
    valid: set.valid,
    thresholdCheck: set.thresholdCheck,
    safeApiError: set.safeApiError,
  };
}

async function resolvePageSet(
  spec: SetSpec,
  head: BlockRef,
  open: boolean,
  reader: PageReader
): Promise<{ set: SignatureSet; computed: Computed; fresh: boolean }> {
  const key = pageMemoKey(spec, head, open);
  for (let joins = 0; joins < MAX_JOINS; joins++) {
    const found = pageMemo.get(key);
    if (found?.kept && found.expiresAt > Date.now() && standsForPage(found.kept, open))
      return { set: pageAnswer(spec, head, open, found.kept), computed: found.kept, fresh: false };
    if (!found || found.kept !== null || found.expiresAt <= Date.now()) break;
    if (reader === "request" && found.engine) requestJoinsEngineWork(found.promise);
    const shared = await found.promise.then(
      (computed) => ({ ok: true as const, computed }),
      (error: unknown) => ({ ok: false as const, error })
    );
    if (shared.ok) {
      if (standsForPage(shared.computed, open))
        return {
          set: pageAnswer(spec, head, open, shared.computed),
          computed: shared.computed,
          fresh: false,
        };
    } else if (reader === "engine" || !found.engine) {
      throw shared.error;
    }
  }
  const computing = computePage(spec, head, open, reader);
  const entry: PageEntry = {
    promise: computing,
    kept: null,
    expiresAt: FOREVER,
    engine: reader === "engine",
  };
  sweepPageMemo();
  pageMemo.set(key, entry);
  computing.then(
    (result) => {
      if (pageMemo.get(key) !== entry) return;
      remember(spec, head.number, result);
      if (result.byHash || result.set.safeApiError !== null) {
        pageMemo.delete(key);
        return;
      }
      entry.kept = result;
      entry.expiresAt = Date.now() + MEMO_TTL_MS;
      // From copies at most 60 s old (stands()), it is JSON's strict result too: JSON at a head the
      // engine verified asks nothing more.
      const strictKey = memoKey(spec, head);
      const existing = memo.get(strictKey);
      const replaceable = !existing || (existing.kept !== null && !holds(existing));
      if (replaceable && stands(result))
        memo.set(strictKey, {
          promise: Promise.resolve(result),
          kept: result,
          expiresAt: Date.now() + MEMO_TTL_MS,
        });
    },
    () => {
      if (pageMemo.get(key) === entry) pageMemo.delete(key);
    }
  );
  const computed = await computing;
  return { set: pageAnswer(spec, head, open, computed), computed, fresh: true };
}

/**
 * The set as a page shows it: verified at the head from copies under the page rule. ?sig=, a past
 * block and dev nodes get the strict result, with no revision.
 */
export async function verifyPageSignatureSet(params: SignatureSetParams): Promise<SignatureSet> {
  const supplied = params.supplied ?? [];
  const spec = specOf(params);
  const net = await network();
  if (supplied.length > 0 || params.blockNumber !== undefined) {
    const set = await verifySignatureSet(params);
    return { ...set, watch: { key: setKeyOf(spec), rev: null }, safeCheck: null };
  }
  if (net.isDevNode) {
    // At 'latest', as JSON, with its content's revision, so a page learns when a listing changed.
    const computed = await computeSet(spec, [], { kind: "latest" }, fromSafe);
    // The Safe watcher follows it (block 0: every result at 'latest' replaces the last).
    remember(spec, 0n, computed);
    const watch = noteContent(
      setKeyOf(spec),
      { head: 0n, order: orderOf(computed) },
      setContent(computed.set)
    );
    return {
      ...computed.set,
      watch,
      safeCheck: params.open ? watchedCheck(spec, computed.set) : null,
    };
  }
  const head = await latestBlock();
  return (await resolvePageSet(spec, head, params.open === true, "request")).set;
}

function pageInFlight(spec: SetSpec, head: BlockRef): PageEntry | null {
  for (const open of [true, false]) {
    const found = pageMemo.get(pageMemoKey(spec, head, open));
    if (found && found.kept === null && found.expiresAt > Date.now()) return found;
  }
  return null;
}

function pageHolds(spec: SetSpec, head: BlockRef, open: boolean): boolean {
  const found = pageMemo.get(pageMemoKey(spec, head, open));
  return !!found?.kept && found.expiresAt > Date.now() && standsForPage(found.kept, open);
}

// ---- a page's first answer ----

// Each set's last strict result (never with a supplied signature), for a page's first answer.
const LAST_RESULTS_LIMIT = 256;
const LAST_RESULT_FOR_MS = 24 * 60 * 60_000;
type LastResult = { set: SignatureSet; block: bigint; storedAt: number };
const lastResults = new Map<string, LastResult>();

function remember(spec: SetSpec, block: bigint, computed: Computed) {
  // A result Safe could not answer for leaves the last one it did answer for.
  if (computed.set.safeApiError !== null) return;
  // Never replaced by one verified at an older block (computations can end out of order).
  const previous = lastResults.get(spec.key);
  if (previous && previous.block > block) return;
  // Members rechecked since a head this result is not older than: it says what they are now.
  const recheck = rechecks.get(spec.key);
  if (recheck && block >= recheck.block) rechecks.delete(spec.key);
  lastResults.delete(spec.key);
  lastResults.set(spec.key, { set: computed.set, block, storedAt: Date.now() });
  while (lastResults.size > LAST_RESULTS_LIMIT)
    lastResults.delete(lastResults.keys().next().value as string);
}

function lastResult(key: string): LastResult | null {
  const found = lastResults.get(key);
  if (!found) return null;
  if (Date.now() - found.storedAt <= LAST_RESULT_FOR_MS) return found;
  lastResults.delete(key);
  return null;
}

/**
 * A page's first answer, never waiting on Safe: the kept page result (then `fresh` itself), else
 * the set's last strict result, else a verification from the listings held whatever their age.
 * Those two are labelled `stale: true`; ?sig=, a past block and dev nodes always get `fresh`.
 */
export async function firstSignatureSet(
  params: SignatureSetParams,
  fresh: Promise<SignatureSet>
): Promise<SignatureSet> {
  if ((params.supplied?.length ?? 0) > 0 || params.blockNumber !== undefined) return fresh;
  let freshIn = false;
  fresh.then(
    () => {
      freshIn = true;
    },
    () => {}
  );
  let early: SignatureSet | null = null;
  try {
    early = await earlyAnswer(specOf(params), params.open === true);
  } catch {
    // A read it needed failed: the fresh result answers, or says why not.
  }
  return early === null || freshIn ? fresh : early;
}

async function earlyAnswer(spec: SetSpec, open: boolean): Promise<SignatureSet | null> {
  if ((await network()).isDevNode) return null;
  // With a last result to show, never wait for a head read in flight (the first flush carries it).
  const last = lastResult(spec.key);
  const served = last ? null : servedHead();
  let head = last ? servedHeadNow() : served ? await served.catch(() => null) : null;
  // A result at the head already stands: the page's own comes at once, without Safe.
  const current = (at: BlockRef) => pageHolds(spec, at, open) || holds(memo.get(memoKey(spec, at)));
  if (head && current(head)) return null;
  if (last) return asFirstAnswer(last.set, head);
  head ??= await latestBlock();
  if (current(head)) return null;
  let computed: Computed;
  try {
    computed = await computeSet(spec, [], { kind: "head", head }, fromHeld);
  } catch (error) {
    if (error instanceof NeedsSafeRead) return null;
    throw error;
  }
  return computed.staleCopies ? asFirstAnswer(computed.set, head) : null;
}

function asFirstAnswer(set: SignatureSet, head: BlockRef | null): SignatureSet {
  return {
    ...set,
    stale: true,
    reverifyingAt: head ? head.number.toString() : null,
    watch: undefined,
    safeCheck: null,
  };
}

// The sets pages show, by page key: at most 256, each for 24 hours. A precompute covers at most 64
// of those on screen, so what runs at every block stays bounded.
const PAGE_SETS_LIMIT = 256;
const PAGE_SET_FOR_MS = 24 * 60 * 60_000;
const PRECOMPUTE_LIMIT = 64;
type PageSet = { spec: SetSpec; shownAt: number; open: boolean; openUntil?: bigint };
const pageSets = new Map<string, PageSet>();

function setKeyOf(spec: SetSpec): string {
  return `set:${createHash("sha256").update(spec.key).digest("hex").slice(0, 32)}`;
}

/** Registers the set a page shows (never supplied signatures) for the engine; returns its key. */
export function watchSignatureSet(params: SignatureSetParams): WatchItem {
  const spec = specOf(params);
  const key = setKeyOf(spec);
  const before = pageSets.get(key);
  pageSets.delete(key);
  pageSets.set(key, {
    spec,
    shownAt: Date.now(),
    open: params.open === true,
    openUntil: params.open === true ? params.openUntil : undefined,
  });
  while (pageSets.size > PAGE_SETS_LIMIT) pageSets.delete(pageSets.keys().next().value as string);
  onPageLoad(key);
  if (!before || before.open !== (params.open === true)) nudgeSafeWatch();
  return { key, rev: null };
}

export async function reverifyPageSet(key: string): Promise<SignatureSet | null> {
  const entry = pageSets.get(key);
  if (!entry || Date.now() - entry.shownAt > PAGE_SET_FOR_MS) return null;
  const { key: _key, ...params } = entry.spec;
  return verifyPageSignatureSet({ ...params, open: entry.open });
}

export function pageSetSafeCheck(key: string): SafeCheck | null {
  const entry = pageSets.get(key);
  if (!entry?.open || Date.now() - entry.shownAt > PAGE_SET_FOR_MS) return null;
  const members = watchedMembersOf(entry.spec);
  return members.length > 0 ? safeCheckOf(members) : null;
}

export function pageSetOf(key: string): { members: readonly Address[]; open: boolean } | null {
  const entry = pageSets.get(key);
  if (!entry || Date.now() - entry.shownAt > PAGE_SET_FOR_MS) return null;
  return { members: entry.spec.members, open: entry.open };
}

function onScreenSets(): PageSet[] {
  const keys = presence().onScreen();
  const now = Date.now();
  const sets: PageSet[] = [];
  for (const [key, entry] of pageSets) {
    if (now - entry.shownAt > PAGE_SET_FOR_MS) pageSets.delete(key);
    else if (keys.has(key)) sets.push(entry);
  }
  return sets.reverse();
}

function precomputeEntries(): PageSet[] {
  return onScreenSets().slice(0, PRECOMPUTE_LIMIT);
}

function precomputeSpecs(): SetSpec[] {
  return precomputeEntries().map((entry) => entry.spec);
}

export function onScreenSigners({ openOnly = false }: { openOnly?: boolean } = {}): {
  group: SignerGroup;
  members: readonly Address[];
}[] {
  return precomputeEntries()
    .filter((entry) => !openOnly || entry.open)
    .map(({ spec }) => ({ group: spec.signerGroup, members: spec.members }));
}

/**
 * The member Safes the watcher checks: of each open set on screen, the members not valid in its
 * latest result (all before it has one) and those rechecked. Asked again at every look.
 */
export function watchedSetMembers(): Address[] {
  const safes = new Map<string, Address>();
  for (const { spec, open } of precomputeEntries()) {
    if (!open) continue;
    for (const member of watchedMembersOf(spec)) safes.set(member.toLowerCase(), member);
  }
  return [...safes.values()];
}

export function onScreenSafeChecks(): Record<string, SafeCheck> {
  const checks: Record<string, SafeCheck> = {};
  for (const { spec, open } of precomputeEntries()) {
    if (!open) continue;
    const members = watchedMembersOf(spec);
    if (members.length > 0) checks[setKeyOf(spec)] = safeCheckOf(members);
  }
  return checks;
}

// Sets verified at once share the head's aggregate3 (pages show 3 to 6 sets at a time).
export const PRECOMPUTE_CONCURRENCY = 16;

export type PrecomputeRun = {
  block: string;
  trigger: "head" | "safe";
  sets: number;
  verified: number;
  reused: number;
  skipped: number;
  failed: number;
  ms: number;
};

let lastRun: PrecomputeRun | null = null;

// Settings changes and dev-node refreshes drop everything here; invalidate("verify:") the results.
linkStore("verify:", (prefix) => {
  memo.clear();
  pageMemo.clear();
  lastResults.clear();
  rechecks.clear();
  if (prefix === null) {
    pageSets.clear();
    simulations.clear();
    lastRun = null;
  }
});

/**
 * Verifies the sets on screen at `head` (only those with a member in `safes`, when given) as pages
 * show them, from Safe copies the store holds; a set that would need Safe is left to the request.
 */
export async function precomputeSignatureSets(
  head: BlockRef,
  options: { current?: () => boolean; safes?: ReadonlySet<string> } = {}
): Promise<PrecomputeRun> {
  const started = Date.now();
  const current = options.current ?? (() => true);
  const safes = options.safes;
  // A set open only until a time (validUntil) is closed at a head past it: its page reloads.
  for (const entry of precomputeEntries())
    if (entry.open && entry.openUntil !== undefined && head.timestamp >= entry.openUntil) {
      entry.open = false;
      touchRev(setKeyOf(entry.spec));
    }
  const entries = precomputeEntries().filter(
    ({ spec }) => !safes || spec.members.some((m) => safes.has(m.toLowerCase()))
  );
  const run: PrecomputeRun = {
    block: head.number.toString(),
    trigger: safes ? "safe" : "head",
    sets: entries.length,
    verified: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
    ms: 0,
  };
  const limit = concurrencyLimit(PRECOMPUTE_CONCURRENCY);
  await Promise.all(
    entries.map(({ spec, open }) =>
      limit(async () => {
        if (!current()) {
          run.skipped++;
          return;
        }
        try {
          const { fresh } = await resolvePageSet(spec, head, open, "engine");
          if (fresh) run.verified++;
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
  if (run.verified > 0) nudgeSafeWatch();
  return run;
}

export type SignatureWatchDriver = {
  active: () => boolean;
  viewing?: () => boolean;
  head: () => Promise<BlockRef> | null;
  /** A dev node in use: pages showing a changed set are told to reload. */
  readsAtLatest?: () => boolean;
};

let driver: SignatureWatchDriver | null = null;
let unsubscribe: (() => void) | null = null;
const changed = new Set<string>();
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let rechecking = false;
const CHANGE_SETTLE_MS = 100;

/** While `active()`, a set on screen is verified again when a member's listing changes. */
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
  const key = safe.toLowerCase();
  const affected = precomputeSpecs().filter((spec) =>
    spec.members.some((m) => m.toLowerCase() === key)
  );
  if (affected.length === 0) return;
  if (!driver?.active()) {
    if (driver?.readsAtLatest?.()) for (const spec of affected) touchRev(setKeyOf(spec));
    return;
  }
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
    const at = await head;
    await asEngineWork(() =>
      precomputeSignatureSets(at, {
        safes,
        current: () =>
          rpcGeneration() === generation &&
          current === driver &&
          current.active() &&
          (current.viewing?.() ?? true),
      })
    );
  } catch {
    // No head to verify at (its read failed): the next tick or request verifies.
  } finally {
    rechecking = false;
    if (changed.size > 0) scheduleRecheck();
  }
}

export type SignatureSetsStatus = {
  watched: number;
  onScreen: number;
  /** The same as onScreen (kept for older readers). */
  recent: number;
  open: number;
  /** At the last precompute's block: `fast` positives from the aggregate, `reasked`, `direct`. */
  perBlock: VerdictCounts | null;
  lastRecompute: PrecomputeRun | null;
  /** The same as lastRecompute (kept for older readers). */
  lastRun: PrecomputeRun | null;
};

export function signatureSetsStatus(): SignatureSetsStatus {
  const sets = onScreenSets();
  return {
    watched: pageSets.size,
    onScreen: sets.length,
    recent: sets.length,
    open: sets.filter((entry) => entry.open).length,
    perBlock: lastRun ? verdictCounts(lastRun.block) : null,
    lastRecompute: lastRun && { ...lastRun },
    lastRun: lastRun && { ...lastRun },
  };
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

export type Simulation = (
  | { status: "ok" }
  | { status: "reverted"; error: string }
  | { status: "skipped"; reason: string }
) & {
  atBlock?: string;
  /** Pages only: the `sim:` key it is simulated again under at each head, with its revision. */
  watch?: WatchItem;
};

// A funded stand-in sender, so payable calls (the L2 veto forwards txMintValue) can be simulated.
const SIMULATION_SENDER: Address = "0x000000000000000000000000000000000000dEaD";

export type SimulateOptions = {
  /**
   * No supplied signature (?sig=): simulated at the head and kept under its hash, so requests at
   * one head ask once. Otherwise, and on a dev node, at 'latest' every time, kept nowhere.
   */
  keep?: boolean;
  page?: boolean;
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
 * "reverted" only for a definite revert; any other failure is "skipped", never a verdict on the
 * transaction, and never kept.
 */
export async function simulateCall(
  request: CallRequest,
  { keep = false, page = false }: SimulateOptions = {}
): Promise<Simulation> {
  if (keep && request.blockNumber === undefined) {
    let head: BlockRef | null;
    try {
      head = (await network()).isDevNode ? null : await latestBlock();
    } catch (error) {
      return skipped(error);
    }
    if (head) {
      const simulation = {
        ...(await simulateAtHead(request, head)),
        atBlock: head.number.toString(),
      };
      return page ? watchSimulation(request, head, simulation) : simulation;
    }
  }
  return simulateAt(request);
}

// The simulations pages show, by key, for the engine: at most 64, each for 24 hours.
const SIMULATIONS_LIMIT = 64;
const SIMULATION_FOR_MS = 24 * 60 * 60_000;
const simulations = new Map<string, { request: CallRequest; shownAt: number }>();

function simulationKeyOf(request: CallRequest): string {
  const overrides = (request.stateOverride ?? [])
    .map(({ address, balance }) => `${address.toLowerCase()}=${balance}`)
    .join(",");
  const identity = [
    request.from?.toLowerCase() ?? "",
    request.to.toLowerCase(),
    request.value ?? 0n,
    request.data.toLowerCase(),
    overrides,
  ].join("|");
  return `sim:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export const simulationContent = (simulation: Simulation) =>
  simulation.status === "reverted"
    ? { status: simulation.status, error: simulation.error }
    : { status: simulation.status };

function watchSimulation(request: CallRequest, head: BlockRef, simulation: Simulation): Simulation {
  const key = simulationKeyOf(request);
  simulations.delete(key);
  simulations.set(key, { request, shownAt: Date.now() });
  while (simulations.size > SIMULATIONS_LIMIT)
    simulations.delete(simulations.keys().next().value as string);
  onPageLoad(key);
  const watch = noteContent(key, { head: head.number }, simulationContent(simulation));
  return { ...simulation, watch };
}

/**
 * The engine's step: each simulation on screen, at `head`, its result noted for its revision. An
 * RPC failure notes nothing: the page keeps its older result, labelled with its block.
 */
export async function resimulateOnScreen(
  head: BlockRef,
  keys: Iterable<string>,
  current: () => boolean = () => true
): Promise<{ noted: number; skipped: number }> {
  const tally = { noted: 0, skipped: 0 };
  const now = Date.now();
  await Promise.all(
    [...keys]
      .filter((key) => key.startsWith("sim:"))
      .map(async (key) => {
        const entry = simulations.get(key);
        if (!entry || now - entry.shownAt > SIMULATION_FOR_MS || !current()) {
          tally.skipped++;
          return;
        }
        const simulation = await simulateAtHead(entry.request, head).catch(skipped);
        if (simulation.status === "skipped" || !current()) {
          tally.skipped++;
          return;
        }
        noteContent(key, { head: head.number }, simulationContent(simulation));
        tally.noted++;
      })
  );
  return tally;
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
