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
} from "viem";
import { cached } from "./cache";
import { type SafeInfo, safeInfo } from "./governance";
import { l1, network } from "./rpc";
import { SafeApiError, findSafeMessage, safeWalletUrl } from "./safe-api";

// The verification core. A signature counts only if the contract that will consume it accepts it in
// an eth_call: Multisig.checkSignatures for council/guardian members, and the Safe's own
// EIP-1271 isValidSignature for the ZK Foundation (exactly what EmergencyUpgradeBoard calls).
// The Safe Transaction Service is just one place to look for candidates.

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

/** True only when the contract itself rejected the call (not when the RPC failed). */
export function isRevert(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk((e) => e instanceof ContractFunctionRevertedError) !== null
  );
}

export function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.data?.errorName ?? reverted.shortMessage;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

async function accepts(
  check: SignatureCheck,
  digest: Hex,
  signatures: MemberSignature[],
  threshold: number,
  blockNumber?: bigint
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (check.kind === "multisig") {
      const sorted = sortBySigner(signatures);
      await l1.readContract({
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
      });
      return { ok: true };
    }
    const signature =
      check.kind === "safe-1271"
        ? signatures[0]?.signature ?? "0x"
        : encodeMultisigSignature(signatures);
    const result = await l1.readContract({
      address: check.contract,
      abi: safeAbi,
      functionName: "isValidSignature",
      args: [digest, signature],
      blockNumber,
    });
    return result === ERC1271_MAGIC_VALUE
      ? { ok: true }
      : { ok: false, error: `returned ${result}` };
  } catch (error) {
    // An RPC failure must never read as "signature invalid": let it fail the page instead.
    if (!isRevert(error)) throw error;
    return { ok: false, error: revertReason(error) };
  }
}

// One member's signature checked alone. Multisig members go through checkSignatures with
// threshold 1, which also enforces membership.
function acceptsOne(
  check: SignatureCheck,
  digest: Hex,
  signature: MemberSignature,
  blockNumber?: bigint
) {
  const single: SignatureCheck =
    check.kind === "multisig-1271" ? { kind: "multisig", contract: check.contract } : check;
  const key = `accepts:${single.kind}:${single.contract}:${digest}:${signature.signer}:${signature.signature}:${blockNumber ?? "latest"}`;
  return cached(key, blockNumber === undefined ? 60_000 : Number.POSITIVE_INFINITY, () =>
    accepts(single, digest, [signature], 1, blockNumber)
  );
}

type Candidate = {
  source: SignatureSource;
  signature: Hex;
  confirmations?: number;
  signedAt?: string;
};

export async function verifySignatureSet(params: {
  action: ActionName;
  signerGroup: SignerGroup;
  typedData: GovernanceTypedData;
  members: Address[];
  threshold: number;
  check: SignatureCheck;
  supplied?: MemberSignature[];
  blockNumber?: bigint;
}): Promise<SignatureSet> {
  const { chainId } = await network();
  const hashes = governanceHashes(params.typedData);
  let safeApiError: string | null = null;

  const members = await Promise.all(
    params.members.map(async (member): Promise<MemberResult> => {
      const [info, walletUrl] = await Promise.all([safeInfo(member), safeWalletUrl(member)]);
      const memberHashes = info.isContract
        ? safeMessageHashes(chainId, member, hashes.digest)
        : null;
      const candidates: Candidate[] = (params.supplied ?? [])
        .filter((s) => isAddressEqual(s.signer, member))
        .map((s) => ({ source: "supplied", signature: s.signature }));

      let apiUnavailable = false;
      if (memberHashes) {
        try {
          const message = await findSafeMessage(member, memberHashes.safeMessageHash);
          if (message?.preparedSignature) {
            candidates.push({
              source: "safe",
              signature: message.preparedSignature,
              confirmations: message.confirmations.length,
              signedAt: message.created,
            });
          }
        } catch (error) {
          apiUnavailable = true;
          safeApiError = error instanceof SafeApiError ? error.message : String(error);
        }
        // A Safe can also approve a message on-chain (SignMessageLib); the signature is then empty.
        if (!candidates.some((c) => c.source === "safe")) {
          const approved = await cached(
            `signed-messages:${member}:${memberHashes.safeMessageHash}:${params.blockNumber ?? "latest"}`,
            60_000,
            () =>
              l1
                .readContract({
                  address: member,
                  abi: safeAbi,
                  functionName: "signedMessages",
                  args: [memberHashes.safeMessageHash],
                  blockNumber: params.blockNumber,
                })
                // A revert means "not approved"; an RPC failure must surface, not read as missing.
                .catch((error) => {
                  if (isRevert(error)) return 0n;
                  throw error;
                })
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
          params.blockNumber
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
    const result = await accepts(
      params.check,
      hashes.digest,
      valid,
      params.threshold,
      params.blockNumber
    );
    thresholdCheck = result.ok
      ? { status: "met", checkedWith }
      : { status: "rejected", checkedWith, error: result.error };
  }

  return {
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

export type Simulation =
  | { status: "ok" }
  | { status: "reverted"; error: string }
  | { status: "skipped"; reason: string };

// A funded stand-in sender, so payable calls (the L2 veto forwards txMintValue) can be simulated.
const SIMULATION_SENDER: Address = "0x000000000000000000000000000000000000dEaD";

/** eth_call of the execution transaction against the latest state. Nothing is sent. */
export async function simulate(execution: {
  to: Address;
  data: Hex;
  value: string;
}): Promise<Simulation> {
  const value = BigInt(execution.value);
  try {
    await l1.call({
      account: SIMULATION_SENDER,
      to: execution.to,
      data: execution.data,
      value,
      stateOverride:
        value > 0n ? [{ address: SIMULATION_SENDER, balance: value + 10n ** 18n }] : undefined,
    });
    return { status: "ok" };
  } catch (error) {
    return isRevert(error)
      ? { status: "reverted", error: revertReason(error) }
      : { status: "skipped", reason: `RPC error: ${revertReason(error)}` };
  }
}
