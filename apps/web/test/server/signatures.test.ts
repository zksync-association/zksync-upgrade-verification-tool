import { clearCache } from "@/.server/cache";
import { CallReverted, NoContract, UndecodableResult, UpstreamError } from "@/.server/chain/call";
import type { Lane } from "@/.server/chain/jsonrpc";
import { ERC1271_MAGIC_VALUE, guardiansAbi, safeAbi } from "@/common/abis";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import {
  type Address,
  CallExecutionError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  type Hex,
  HttpRequestError,
  InternalRpcError,
  RpcRequestError,
  getAddress,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContractCall,
  RawResult,
  contracts,
  fakeCallLane,
  internalError,
  outOfGas,
  revertWith,
} from "../support/fake-calls";
import { FakeRpcError } from "../support/fake-jsonrpc";

// verifySignatureSet with the chain and Safe replaced by fakes: which candidate counts, and which
// status a member gets, must depend only on what the contract says. The contract sits behind a
// fake JSON-RPC upstream and the real l1-call lane, so every read takes the app's direct eth_call
// path (chain/call.ts) and its errors are the node's raw shapes.

const state = vi.hoisted(() => ({
  lane: null as Lane | null,
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
  codeless: new Set<string>(),
  // A raw JSON-RPC error (or result) for every call of one function: `${functionName}` or
  // `${functionName}:combined` (only the call with more than one signer).
  inject: new Map<string, unknown>(),
  // Every single-signer checkSignatures the contract was asked: `${signer}:${signature}@${block}`.
  checked: [] as string[],
  // The finality boundary cannot be read.
  headDown: false,
  // The finality boundary F, and what its read waits for before answering (null: nothing).
  safe: 1_000n,
  boundaryGate: null as (() => Promise<unknown>) | null,
  // Called when the contract answers a single-signer checkSignatures.
  onCheck: null as (() => void) | null,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({ chainId: 1, safeWalletPrefix: "eth", isDevNode: false }),
  safeBlockNumber: async () => {
    if (state.headDown) throw new Error("head unavailable");
    await state.boundaryGate?.();
    return state.safe;
  },
  lanes: () => ({ call: state.lane }),
}));

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
  return { SafeApiError, safeWalletUrl: async () => null };
});
vi.mock("@/.server/safe/store", async () => {
  const { SafeApiError } = await import("@/.server/safe-api");
  return {
    findSafeMessage: async (_safe: string, hash: string) => {
      if (state.safeApiDown) throw new SafeApiError("Safe Transaction Service returned HTTP 503");
      return state.safeMessages.get(hash) ?? null;
    },
  };
});

const { verifySignatureSet, isRevert, revertReason, simulate, simulateCall } = await import(
  "@/.server/signatures"
);
const { safeMessageHashes } = await import("@/common/safe");

const COUNCIL = getAddress("0x59195219d1176E42f8e607e9AC114926D47f9035");
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
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

/** The fake contracts: a Multisig (checkSignatures, isValidSignature) and member Safes. */
function answer(call: ContractCall): unknown {
  const combined =
    call.functionName === "checkSignatures" && (call.args[1] as unknown[]).length > 1;
  const injected =
    (combined ? state.inject.get(`${call.functionName}:combined`) : undefined) ??
    state.inject.get(call.functionName);
  if (injected !== undefined) return injected;
  if (call.functionName === "signedMessages") {
    return state.approvedOnChain.has(`${call.to}:${call.args[0]}`) ? 1n : 0n;
  }
  if (call.functionName === "checkSignatures") {
    const [, signers, signatures] = call.args as [Hex, string[], Hex[]];
    if (!combined) {
      state.checked.push(`${signers[0]}:${signatures[0]}@${call.block}`);
      state.onCheck?.();
    }
    if (combined && state.rejectCombined) return revertWith("GS026");
    for (const [i, signer] of signers.entries()) {
      if (!state.valid.has(`${signer}:${signatures[i]}`))
        return revertWith("Signature verification failed");
    }
    return undefined;
  }
  if (call.functionName === "isValidSignature") {
    const [, signature] = call.args as [Hex, Hex];
    return state.valid.has(`${call.to}:${signature}`) ? ERC1271_MAGIC_VALUE : revertWith("GS026");
  }
  throw new Error(`unexpected ${call.functionName}`);
}

let calls: () => { params: unknown[] }[];
let codeReads: () => number;

const run = (
  threshold = 2,
  supplied: { signer: Hex; signature: Hex }[] = [],
  check: Parameters<typeof verifySignatureSet>[0]["check"] = { kind: "multisig", contract: COUNCIL }
) =>
  verifySignatureSet({
    action: "ApproveUpgradeSecurityCouncil",
    signerGroup: "securityCouncil",
    typedData,
    members: MEMBERS,
    threshold,
    check,
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
  state.codeless.clear();
  state.inject.clear();
  state.checked = [];
  state.headDown = false;
  state.safe = 1_000n;
  state.boundaryGate = null;
  state.onCheck = null;
  const fake = fakeCallLane(
    contracts({
      abis: [guardiansAbi, safeAbi],
      call: answer,
      code: (address) => (state.codeless.has(getAddress(address)) ? "0x" : "0x6080"),
    }),
    {
      intercept: () =>
        state.rpcDown ? new Response("Service Unavailable", { status: 503 }) : undefined,
    }
  );
  state.lane = fake.lane;
  calls = fake.calls;
  codeReads = () =>
    fake.upstream.posts.flatMap((p) => p.calls).filter((c) => c.method === "eth_getCode").length;
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
    // Every read was a plain eth_call to the contract itself, never an aggregate3.
    expect(calls().length).toBeGreaterThan(0);
    expect(calls().every((c) => (c.params[0] as { to: string }).to !== MULTICALL3)).toBe(true);
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
    // Three member checks and the combined one need the council's code, read once for all.
    expect(codeReads()).toBe(1);
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
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("treats only definite contract reverts as rejections", () => {
    const rpc = (code: number, message: string) =>
      new RpcRequestError({ body: {}, error: { code, message }, url: "http://rpc" });
    expect(isRevert(new CallReverted("GS026", "0x", 3))).toBe(true);
    expect(
      isRevert(
        new CallExecutionError(new ExecutionRevertedError({ cause: rpc(3, "reverted") }), {})
      )
    ).toBe(true);
    // viem's readContract reports code 3, -32603 and a failed aggregate3 sub-call all as this,
    // without the node's code: it is not evidence of a revert.
    expect(
      isRevert(new ContractFunctionRevertedError({ abi: [], functionName: "f", message: "x" }))
    ).toBe(false);
    expect(isRevert(new InternalRpcError(rpc(-32603, "execution reverted")))).toBe(false);
    expect(isRevert(new UpstreamError("internal error (JSON-RPC error -32603)"))).toBe(false);
    expect(isRevert(new HttpRequestError({ url: "http://rpc", status: 500 }))).toBe(false);
    expect(isRevert(new Error("socket hang up"))).toBe(false);
    expect(revertReason(new CallReverted("GS026", "0x", 3))).toBe("GS026");
  });
});

describe("what is kept", () => {
  const at = (blockNumber?: bigint, supplied: { signer: Hex; signature: Hex }[] = []) =>
    verifySignatureSet({
      action: "ApproveUpgradeSecurityCouncil",
      signerGroup: "securityCouncil",
      typedData,
      members: MEMBERS,
      threshold: 2,
      check: { kind: "multisig", contract: COUNCIL },
      supplied,
      blockNumber,
    });
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    return () => vi.useRealTimers();
  });

  it("never keeps the verdict on a supplied signature; keeps Safe's a minute", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
    await at(undefined, supplied);
    await at(undefined, supplied);
    expect(state.checked).toEqual([
      `${MEMBERS[0]}:0xaa@latest`,
      `${MEMBERS[1]}:0xcc@latest`,
      `${MEMBERS[1]}:0xcc@latest`,
    ]);
    later(61_000);
    await at();
    expect(state.checked.filter((c) => c.startsWith(`${MEMBERS[0]}:`))).toHaveLength(2);
  });

  it("never keeps a supplied verdict, not even at a final block", async () => {
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
    expect((await at(900n, supplied)).members[1]).toMatchObject({ status: "valid" });
    expect((await at(900n, supplied)).members[1]).toMatchObject({ status: "valid" });
    expect(state.checked).toEqual([`${MEMBERS[1]}:0xcc@0x384`, `${MEMBERS[1]}:0xcc@0x384`]);
  });

  it("never lets a supplied verdict stand in for Safe's copy of the same signature", async () => {
    // The viewer's ?sig= is checked (and accepted) first...
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
    expect((await at(undefined, supplied)).members[1]).toMatchObject({ source: "supplied" });
    // ...then Safe serves the same bytes: the contract is asked again, under Safe's own entry.
    inSafe(MEMBERS[1] as Hex, "0xcc");
    expect((await at()).members[1]).toMatchObject({ status: "valid", source: "safe" });
    expect(state.checked).toEqual([`${MEMBERS[1]}:0xcc@latest`, `${MEMBERS[1]}:0xcc@latest`]);
    // And a supplied check after it does not read Safe's entry either.
    await at(undefined, supplied);
    expect(state.checked).toHaveLength(3);
  });

  it("keeps a verdict at a final block for good, and above the boundary only a minute", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    await at(900n);
    await at(1_001n);
    later(61_000);
    expect((await at(900n)).members[0]?.status).toBe("valid");
    expect((await at(1_001n)).members[0]?.status).toBe("valid");
    expect(state.checked).toEqual([
      `${MEMBERS[0]}:0xaa@0x384`,
      `${MEMBERS[0]}:0xaa@0x3e9`,
      `${MEMBERS[0]}:0xaa@0x3e9`,
    ]);
  });

  it("reads the boundary before the check: a block that turns final meanwhile is not kept", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    // Block 900 is above F (899) until the contract has answered, then F moves to 1,000. The
    // boundary read answers once the check is answered, or after 50 ms when it has to come first.
    let answered = () => {};
    const checkAnswered = new Promise<void>((resolve) => {
      answered = resolve;
    });
    state.safe = 899n;
    state.onCheck = () => {
      state.safe = 1_000n;
      answered();
    };
    state.boundaryGate = () =>
      Promise.race([checkAnswered, new Promise((resolve) => setTimeout(resolve, 50))]);
    expect((await at(900n)).members[0]?.status).toBe("valid");
    state.onCheck = null;
    state.boundaryGate = null;
    later(61_000);
    await at(900n);
    // Read while block 900 was not final: kept a minute only, so asked again.
    expect(state.checked).toEqual([`${MEMBERS[0]}:0xaa@0x384`, `${MEMBERS[0]}:0xaa@0x384`]);
  });

  it("answers at a past block when finality cannot be read, without keeping it for good", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    state.headDown = true;
    expect((await at(900n)).members[0]?.status).toBe("valid");
    state.headDown = false;
    later(61_000);
    await at(900n);
    expect(state.checked).toEqual([`${MEMBERS[0]}:0xaa@0x384`, `${MEMBERS[0]}:0xaa@0x384`]);
  });
});

// Every place a verdict is read, with the node failing (-32603) or running out of gas: the set
// fails, so the page shows an error instead of an "invalid", "missing" or "rejected".
describe("an RPC failure is never a verdict", () => {
  it.each([
    ["-32603", internalError],
    ["out of gas", outOfGas],
  ])("a member's own check (%s) fails the set instead of marking it invalid", async (_n, error) => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    state.inject.set("checkSignatures", error());
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("the combined threshold check (-32603) fails instead of reading rejected", async () => {
    for (const [i, m] of MEMBERS.entries()) {
      inSafe(m, `0x0${i}` as Hex);
      state.valid.add(`${m}:0x0${i}`);
    }
    state.inject.set("checkSignatures:combined", internalError());
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("an on-chain approval read (-32603) fails instead of reading missing", async () => {
    state.inject.set("signedMessages", internalError());
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("an on-chain approval read that reverts reads as not approved", async () => {
    state.inject.set("signedMessages", revertWith("no such function"));
    const set = await run();
    expect(set.members.map((m) => m.status)).toEqual(["missing", "missing", "missing"]);
  });

  it("an empty revert (code 3, no reason) still rejects", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.inject.set("checkSignatures", new FakeRpcError(3, "execution reverted", "0x"));
    const set = await run();
    expect(set.members[0]).toMatchObject({ status: "invalid", error: "execution reverted" });
  });

  it("a council contract without code never accepts, though the call 'succeeds'", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    state.codeless.add(COUNCIL);
    await expect(run()).rejects.toBeInstanceOf(NoContract);
  });

  it("an EIP-1271 check accepts the magic value and fails on -32603 or empty data", async () => {
    const zkFoundation = MEMBERS[0] as Address;
    const check = { kind: "safe-1271", contract: zkFoundation } as const;
    inSafe(zkFoundation, "0xaa");
    state.valid.add(`${zkFoundation}:0xaa`);
    const set = await run(1, [], check);
    expect(set.members[0]?.status).toBe("valid");
    expect(set.thresholdCheck.status).toBe("met");

    clearCache();
    state.inject.set("isValidSignature", internalError());
    await expect(run(1, [], check)).rejects.toBeInstanceOf(UpstreamError);

    clearCache();
    state.inject.set("isValidSignature", new RawResult("0x"));
    await expect(run(1, [], check)).rejects.toBeInstanceOf(UndecodableResult);

    clearCache();
    state.inject.set("isValidSignature", "0xffffffff");
    const wrong = await run(1, [], check);
    expect(wrong.members[0]).toMatchObject({ status: "invalid", error: "returned 0xffffffff" });
  });

  it("the multisig EIP-1271 threshold check (-32603) fails instead of reading rejected", async () => {
    for (const [i, m] of MEMBERS.entries()) {
      inSafe(m, `0x0${i}` as Hex);
      state.valid.add(`${m}:0x0${i}`);
    }
    const check = { kind: "multisig-1271", contract: COUNCIL } as const;
    state.valid.add(
      `${COUNCIL}:${(await import("@/common/execution")).encodeMultisigSignature(
        MEMBERS.map((signer, i) => ({ signer, signature: `0x0${i}` as Hex }))
      )}`
    );
    expect((await run(3, [], check)).thresholdCheck.status).toBe("met");

    clearCache();
    state.inject.set("isValidSignature", internalError());
    await expect(run(3, [], check)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("simulate", () => {
  const execution = { to: COUNCIL, data: "0x1234" as Hex, value: "0" };

  it("is ok, reverted only on a definite revert, and skipped on an RPC failure", async () => {
    let reply: unknown = "0x";
    const fake = fakeCallLane(() => reply);
    state.lane = fake.lane;
    expect(await simulate(execution)).toEqual({ status: "ok" });

    reply = revertWith("Protocol frozen");
    expect(await simulate(execution)).toEqual({ status: "reverted", error: "Protocol frozen" });

    for (const failure of [internalError(), outOfGas()]) {
      reply = failure;
      const result = await simulate(execution);
      expect(result.status).toBe("skipped");
      expect(result).toMatchObject({ reason: expect.stringMatching(/^RPC error: /) });
    }
  });

  it("funds the stand-in sender for a payable call, and simulates as a given executor", async () => {
    const fake = fakeCallLane(() => "0x");
    state.lane = fake.lane;
    await simulate({ ...execution, value: "7" });
    expect(fake.calls()[0]?.params).toEqual([
      {
        to: COUNCIL,
        data: "0x1234",
        from: "0x000000000000000000000000000000000000dEaD",
        value: "0x7",
      },
      "latest",
      { "0x000000000000000000000000000000000000dEaD": { balance: "0xde0b6b3a7640007" } },
    ]);

    const executor = MEMBERS[0] as Address;
    expect(await simulateCall({ from: executor, to: COUNCIL, data: "0x1234" })).toEqual({
      status: "ok",
    });
    expect(fake.calls()[1]?.params).toEqual([
      { to: COUNCIL, data: "0x1234", from: executor },
      "latest",
    ]);
  });

  it("as the executor: reverted only on a definite revert, skipped on -32603", async () => {
    const executor = MEMBERS[0] as Address;
    let reply: unknown = revertWith("Upgrade is not yet ready");
    state.lane = fakeCallLane(() => reply).lane;
    expect(await simulateCall({ from: executor, to: COUNCIL, data: "0x1234" })).toEqual({
      status: "reverted",
      error: "Upgrade is not yet ready",
    });
    reply = internalError();
    expect(await simulateCall({ from: executor, to: COUNCIL, data: "0x1234" })).toMatchObject({
      status: "skipped",
    });
  });
});
