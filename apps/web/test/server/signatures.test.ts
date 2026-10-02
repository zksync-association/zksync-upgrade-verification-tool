import { clearCache } from "@/.server/cache";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import { ContractFunctionRevertedError, type Hex, HttpRequestError, getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// verifySignatureSet with the chain and Safe replaced by fakes: which candidate counts, and which
// status a member gets, must depend only on what the contract says.

const state = vi.hoisted(() => ({
  valid: new Set<string>(), // `${signer}:${signature}` the contract accepts
  approvedOnChain: new Set<string>(), // `${safe}:${safeMessageHash}`
  safeMessages: new Map<
    string,
    { preparedSignature: Hex; confirmations: unknown[]; created: string }
  >(),
  safeApiDown: false,
  rpcDown: false,
  safeThreshold: 1,
  rejectCombined: false,
}));

vi.mock("@/.server/rpc", async () => {
  const viem = await import("viem");
  const revert = (message: string) =>
    new viem.ContractFunctionRevertedError({ abi: [], functionName: "checkSignatures", message });
  return {
    network: async () => ({ chainId: 1, safeWalletPrefix: "eth" }),
    l1: {
      readContract: async ({
        functionName,
        args,
        address,
      }: { functionName: string; args: unknown[]; address: string }) => {
        if (state.rpcDown) throw new viem.HttpRequestError({ url: "http://rpc", status: 429 });
        if (functionName === "signedMessages") {
          return state.approvedOnChain.has(`${address}:${args[0]}`) ? 1n : 0n;
        }
        if (functionName === "checkSignatures") {
          const [, signers, signatures] = args as [Hex, string[], Hex[]];
          if (signers.length > 1 && state.rejectCombined) throw revert("GS026");
          signers.forEach((s, i) => {
            if (!state.valid.has(`${s}:${signatures[i]}`))
              throw revert("Signature verification failed");
          });
          return undefined;
        }
        throw new Error(`unexpected ${functionName}`);
      },
    },
  };
});

vi.mock("@/.server/governance", () => ({
  safeInfo: async (address: string) => ({
    address,
    isContract: true,
    version: "1.3.0",
    threshold: state.safeThreshold,
    owners: [],
    domainSeparatorMatches: true,
  }),
}));

vi.mock("@/.server/safe-api", () => {
  class SafeApiError extends Error {}
  return {
    SafeApiError,
    safeWalletUrl: async () => null,
    findSafeMessage: async (_safe: string, hash: string) => {
      if (state.safeApiDown) throw new SafeApiError("Safe Transaction Service returned HTTP 503");
      return state.safeMessages.get(hash) ?? null;
    },
  };
});

const { verifySignatureSet, isRevert } = await import("@/.server/signatures");
const { safeMessageHashes } = await import("@/common/safe");

const COUNCIL = getAddress("0x59195219d1176E42f8e607e9AC114926D47f9035");
const MEMBERS = [
  "0x1000000000000000000000000000000000000001",
  "0x2000000000000000000000000000000000000002",
  "0x3000000000000000000000000000000000000003",
].map((a) => getAddress(a));
const typedData = buildTypedData(
  "ApproveUpgradeSecurityCouncil",
  { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
  { id: `0x${"11".repeat(32)}` }
);
const { digest } = governanceHashes(typedData);
const hashOf = (member: string) => safeMessageHashes(1, member as Hex, digest).safeMessageHash;
const inSafe = (member: string, signature: Hex, confirmations = 1) =>
  state.safeMessages.set(hashOf(member), {
    preparedSignature: signature,
    confirmations: Array(confirmations).fill({}),
    created: "2026-09-30T00:00:00Z",
  });

const run = (threshold = 2, supplied: { signer: Hex; signature: Hex }[] = []) =>
  verifySignatureSet({
    action: "ApproveUpgradeSecurityCouncil",
    signerGroup: "securityCouncil",
    typedData,
    members: MEMBERS,
    threshold,
    check: { kind: "multisig", contract: COUNCIL },
    supplied,
  });

beforeEach(() => {
  clearCache();
  state.valid.clear();
  state.approvedOnChain.clear();
  state.safeMessages.clear();
  state.safeApiDown = false;
  state.rpcDown = false;
  state.safeThreshold = 1;
  state.rejectCombined = false;
});

describe("verifySignatureSet", () => {
  it("counts a Safe signature only when the contract accepts it", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    inSafe(MEMBERS[1] as Hex, "0xbb");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    const set = await run();
    expect(set.members.map((m) => [m.status, m.source])).toEqual([
      ["valid", "safe"],
      ["invalid", "safe"],
      ["missing", null],
    ]);
    expect(set.members[1]?.error).toBe("Signature verification failed");
    expect(set.valid).toEqual([{ signer: MEMBERS[0], signature: "0xaa" }]);
    expect(set.thresholdCheck).toEqual({ status: "below", valid: 1, threshold: 2 });
  });

  it("reports a Safe message still collecting owner signatures", async () => {
    state.safeThreshold = 2;
    inSafe(MEMBERS[0] as Hex, "0xaa", 1);
    const set = await run();
    expect(set.members[0]?.status).toBe("collecting");
  });

  it("accepts a message the Safe approved on-chain (empty signature)", async () => {
    state.approvedOnChain.add(`${MEMBERS[2]}:${hashOf(MEMBERS[2] as string)}`);
    state.valid.add(`${MEMBERS[2]}:0x`);
    const set = await run();
    expect(set.members[2]).toMatchObject({ status: "valid", source: "onchain", signature: "0x" });
  });

  it("uses a supplied signature when it verifies, and ignores one that does not", async () => {
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const set = await run(2, [
      { signer: MEMBERS[1] as Hex, signature: "0xcc" },
      { signer: MEMBERS[2] as Hex, signature: "0xdd" },
    ]);
    expect(set.members[1]).toMatchObject({ status: "valid", source: "supplied" });
    expect(set.members[2]).toMatchObject({ status: "invalid", source: "supplied" });
  });

  it("asks the contract about the combined set once the threshold is reached", async () => {
    for (const [i, m] of MEMBERS.entries()) {
      inSafe(m, `0x0${i}` as Hex);
      state.valid.add(`${m}:0x0${i}`);
    }
    expect((await run()).thresholdCheck.status).toBe("met");
    clearCache();
    state.rejectCombined = true;
    expect((await run()).thresholdCheck).toMatchObject({ status: "rejected", error: "GS026" });
  });

  it("marks members unavailable, not missing, when Safe's API is down", async () => {
    state.safeApiDown = true;
    const set = await run();
    expect(set.members.every((m) => m.status === "unavailable")).toBe(true);
    expect(set.safeApiError).toMatch(/503/);
  });

  it("fails instead of calling a signature invalid when the RPC fails", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.rpcDown = true;
    await expect(run()).rejects.toBeInstanceOf(HttpRequestError);
  });

  it("treats only contract reverts as rejections", () => {
    expect(
      isRevert(new ContractFunctionRevertedError({ abi: [], functionName: "f", message: "x" }))
    ).toBe(true);
    expect(isRevert(new HttpRequestError({ url: "http://rpc", status: 500 }))).toBe(false);
    expect(isRevert(new Error("socket hang up"))).toBe(false);
  });
});
