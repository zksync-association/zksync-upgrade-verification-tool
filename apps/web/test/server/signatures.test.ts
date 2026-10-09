import { clearCache, replace } from "@/.server/cache";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // The head requests read (above the boundary), and whether the node is a dev node.
  head: {
    number: 1_100n,
    hash: `0x${"a1".repeat(32)}`,
    parentHash: `0x${"00".repeat(32)}`,
    timestamp: 1n,
  } as { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint },
  devNode: false,
  // The Safe store: the version of every member's listing, and whether it is at most 60 s old.
  listingVersion: 1,
  listingFresh: true,
  // Listing lookups made (by request reads; precomputes only peek).
  lookups: 0,
  // The next `count` single-signer checkSignatures are answered with `error()` (attempts counts
  // every single-signer checkSignatures asked, answered or not).
  failChecks: { count: 0, error: () => undefined as unknown },
  attempts: 0,
  listeners: new Set<(safe: string) => void>(),
  // Combined checkSignatures asked (more than one signer: the threshold check).
  combined: 0,
  // How long the node takes to answer each POST (ms).
  delay: 0,
  // Every listing is incomplete: messages are looked up by their hash (no listing version).
  byHash: false,
  // The Safes each markSafeDemand call named (a page answered from a kept or shared result).
  demand: [] as string[][],
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({ chainId: 1, safeWalletPrefix: "eth", isDevNode: state.devNode }),
  safeBlockNumber: async () => {
    if (state.headDown) throw new Error("head unavailable");
    await state.boundaryGate?.();
    return state.safe;
  },
  latestBlock: async () => state.head,
  rpcGeneration: () => 1,
  lanes: () => ({ call: state.lane }),
}));

// Safe info cached as the real module caches it (5 minutes, under safeInfoKey).
vi.mock("@/.server/governance", async () => {
  const { cached } = await import("@/.server/cache");
  const safeInfoKey = (address: string) => `safe-info:${address.toLowerCase()}`;
  return {
    safeInfoKey,
    safeInfo: (address: string) =>
      cached(safeInfoKey(address), 5 * 60_000, async () => ({
        address,
        isContract: true,
        version: "1.3.0",
        threshold: state.safeThreshold,
        owners: [],
        domainSeparatorMatches: true,
      })),
  };
});

vi.mock("@/.server/safe-api", () => {
  class SafeApiError extends Error {}
  return { SafeApiError, safeWalletUrl: async () => null };
});
// A Safe snapshot store whose every listing is complete, has one version and is fresh or not.
vi.mock("@/.server/safe/store", async () => {
  const { SafeApiError } = await import("@/.server/safe-api");
  const answer = (hash: string) => ({
    message: state.safeMessages.get(hash) ?? null,
    version: state.byHash ? null : state.listingVersion,
  });
  return {
    lookupSafeMessage: async (_safe: string, hash: string) => {
      state.lookups++;
      if (state.safeApiDown) throw new SafeApiError("Safe Transaction Service returned HTTP 503");
      return answer(hash);
    },
    // A listing that cannot answer (incomplete) is no answer for a precompute.
    peekSafeMessage: (_safe: string, hash: string) =>
      state.listingFresh && !state.safeApiDown && !state.byHash ? answer(hash) : null,
    freshListingVersion: () => (state.listingFresh ? state.listingVersion : null),
    markSafeDemand: (safes: Iterable<string>) => {
      state.demand.push([...safes]);
    },
    onSafeListingChange: (listener: (safe: string) => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
});

const {
  verifySignatureSet,
  isRevert,
  revertReason,
  simulate,
  simulateCall,
  precomputeSignatureSets,
  signatureSetsStatus,
  startSignatureWatch,
  stopSignatureWatch,
} = await import("@/.server/signatures");
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
  if (combined) state.combined++;
  if (call.functionName === "checkSignatures" && !combined) {
    state.attempts++;
    if (state.failChecks.count > 0) {
      state.failChecks.count--;
      return state.failChecks.error();
    }
  }
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
let posts: () => number;
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
  state.head = { ...state.head, number: 1_100n, hash: `0x${"a1".repeat(32)}` };
  state.devNode = false;
  state.listingVersion = 1;
  state.listingFresh = true;
  state.lookups = 0;
  state.failChecks = { count: 0, error: () => undefined };
  state.attempts = 0;
  state.combined = 0;
  state.delay = 0;
  state.byHash = false;
  state.demand = [];
  stopSignatureWatch();
  state.listeners.clear();
  const fake = fakeCallLane(
    contracts({
      abis: [guardiansAbi, safeAbi],
      call: answer,
      code: (address) => (state.codeless.has(getAddress(address)) ? "0x" : "0x6080"),
    }),
    {
      intercept: () =>
        state.rpcDown ? new Response("Service Unavailable", { status: 503 }) : undefined,
      delayMs: () => state.delay,
    }
  );
  state.lane = fake.lane;
  calls = fake.calls;
  posts = () => fake.upstream.posts.length;
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

  it("never keeps the verdict on a supplied signature; keeps Safe's for the head it was read at", async () => {
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
    await at(undefined, supplied);
    await at(undefined, supplied);
    // Pinned to the head requests read (block 1,100), not 'latest'.
    expect(state.checked).toEqual([
      `${MEMBERS[0]}:0xaa@0x44c`,
      `${MEMBERS[1]}:0xcc@0x44c`,
      `${MEMBERS[1]}:0xcc@0x44c`,
    ]);
    // The next head is another entry.
    state.head = { ...state.head, number: 1_101n, hash: `0x${"a2".repeat(32)}` };
    await at();
    expect(state.checked.filter((c) => c.startsWith(`${MEMBERS[0]}:`))).toEqual([
      `${MEMBERS[0]}:0xaa@0x44c`,
      `${MEMBERS[0]}:0xaa@0x44d`,
    ]);
  });

  it("on a dev node reads at 'latest' and keeps Safe's verdict a minute, as before", async () => {
    state.devNode = true;
    inSafe(MEMBERS[0] as Hex, "0xaa");
    state.valid.add(`${MEMBERS[0]}:0xaa`);
    await at();
    await at();
    expect(state.checked).toEqual([`${MEMBERS[0]}:0xaa@latest`]);
    later(61_000);
    await at();
    expect(state.checked).toEqual([`${MEMBERS[0]}:0xaa@latest`, `${MEMBERS[0]}:0xaa@latest`]);
    // Dev nodes keep no set results and watch nothing.
    expect(signatureSetsStatus().watched).toBe(0);
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
    expect(state.checked).toEqual([`${MEMBERS[1]}:0xcc@0x44c`, `${MEMBERS[1]}:0xcc@0x44c`]);
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

// A set's result is kept for the head it was verified at, while the Safe listings it came from
// are still the ones served; the sync engine verifies the sets pages watch again at each new head
// (precomputeSignatureSets), and when a member Safe's listing changes.
describe("kept per head, and precomputed", () => {
  const H1 = `0x${"a1".repeat(32)}` as Hex;
  const nextHead = (hash: Hex = `0x${"a2".repeat(32)}`, number = state.head.number + 1n) => {
    state.head = { ...state.head, number, hash };
    return state.head;
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Two members signed in Safe and the contract accepts both: the threshold (2) is met. */
  const twoSigned = () => {
    for (const [i, m] of MEMBERS.slice(0, 2).entries()) {
      inSafe(m, `0x0${i}` as Hex);
      state.valid.add(`${m}:0x0${i}`);
    }
  };

  it("verifies a set once per head: the next request at that head asks nothing upstream", async () => {
    twoSigned();
    const first = await run();
    expect(first.thresholdCheck.status).toBe("met");
    const sent = posts();
    expect(sent).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) expect(await run()).toBe(first);
    expect(posts()).toBe(sent);
    // Only the first request looked at the listings; the others knew they had not changed.
    expect(state.lookups).toBe(MEMBERS.length);
  });

  it("at the next head the precompute verifies watched sets, and the request asks nothing upstream", async () => {
    twoSigned();
    await run();
    const head = nextHead();
    const precomputed = await precomputeSignatureSets(head);
    expect(precomputed).toMatchObject({ block: "1101", trigger: "head", sets: 1, verified: 1 });
    // Read at the new head (0x44d), from the listings the store holds (no lookup through Safe).
    expect(state.checked.filter((c) => c.endsWith("@0x44d"))).toHaveLength(2);
    expect(state.lookups).toBe(MEMBERS.length);
    const sent = posts();
    const set = await run();
    expect(posts()).toBe(sent);
    expect(state.lookups).toBe(MEMBERS.length);
    expect(set.thresholdCheck.status).toBe("met");
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    // Asked again at the same head: nothing to do.
    expect(await precomputeSignatureSets(head)).toMatchObject({ verified: 0, reused: 1 });
    expect(posts()).toBe(sent);
    expect(signatureSetsStatus()).toMatchObject({
      watched: 1,
      lastRun: { block: "1101", reused: 1 },
    });
  });

  it("leaves to the request a set whose listings are older than 60 s, and the request reads them", async () => {
    twoSigned();
    await run();
    state.listingFresh = false;
    const head = nextHead();
    expect(await precomputeSignatureSets(head)).toMatchObject({ sets: 1, verified: 0, skipped: 1 });
    expect(state.checked.some((c) => c.endsWith("@0x44d"))).toBe(false);
    // The kept result at the old head no longer stands either: listings are never served older.
    state.head = { ...state.head, number: 1_100n, hash: H1 };
    const lookups = state.lookups;
    const sent = posts();
    await run();
    expect(state.lookups).toBe(lookups + MEMBERS.length);
    // The verdicts at this head were kept: only the listings were looked at again.
    expect(posts()).toBe(sent);
  });

  it("a new listing version: the kept result no longer stands, and the watch verifies it again at the served head", async () => {
    twoSigned();
    const before = await run();
    expect(before.members[2]?.status).toBe("missing");
    startSignatureWatch({ active: () => true, head: () => Promise.resolve(state.head) });
    // The third member signs; the store reads its listing with a new version.
    inSafe(MEMBERS[2] as Hex, "0x02");
    state.valid.add(`${MEMBERS[2]}:0x02`);
    state.listingVersion = 2;
    for (const listener of state.listeners) listener((MEMBERS[2] as string).toLowerCase());
    await vi.waitFor(() =>
      expect(signatureSetsStatus().lastRun).toMatchObject({ trigger: "safe", verified: 1 })
    );
    expect(state.checked).toContain(`${MEMBERS[2]}:0x02@0x44c`);
    const sent = posts();
    const after = await run();
    expect(posts()).toBe(sent);
    expect(after.members.map((m) => m.status)).toEqual(["valid", "valid", "valid"]);
  });

  it("does not verify again for a listing change while the engine is idle, or of a Safe no watched set has", async () => {
    twoSigned();
    await run();
    let active = false;
    startSignatureWatch({ active: () => active, head: () => Promise.resolve(state.head) });
    const sent = posts();
    for (const listener of state.listeners) listener((MEMBERS[2] as string).toLowerCase());
    active = true;
    for (const listener of state.listeners) listener(`0x${"99".repeat(20)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(posts()).toBe(sent);
    expect(signatureSetsStatus().lastRun).toBeNull();
  });

  it("never keeps a set with a supplied signature, and does not watch it", async () => {
    state.valid.add(`${MEMBERS[1]}:0xcc`);
    const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
    await run(2, supplied);
    await run(2, supplied);
    expect(state.checked.filter((c) => c.startsWith(`${MEMBERS[1]}:0xcc`))).toHaveLength(2);
    expect(signatureSetsStatus().watched).toBe(0);
    expect(await precomputeSignatureSets(nextHead())).toMatchObject({ sets: 0 });
    // The same set without ?sig= is its own entry: it does not see the supplied verdict.
    state.head = { ...state.head, number: 1_100n, hash: H1 };
    const plain = await run();
    expect(plain.members[1]).toMatchObject({ status: "missing", source: null });
  });

  it("an upstream error (-32603) during the precompute keeps nothing: the request verifies on its own (and fails)", async () => {
    twoSigned();
    await run();
    nextHead();
    state.inject.set("checkSignatures", internalError());
    const sent = posts();
    expect(await precomputeSignatureSets(state.head)).toMatchObject({ verified: 0, failed: 1 });
    expect(posts()).toBeGreaterThan(sent);
    // Nothing was kept: the request asks the contract itself, and gets the same failure.
    const before = posts();
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
    expect(posts()).toBeGreaterThan(before);
    // Once the node answers again, the request verifies.
    state.inject.clear();
    expect((await run()).thresholdCheck.status).toBe("met");
  });

  it("a request that shared a precompute's computation which failed verifies on its own", async () => {
    twoSigned();
    await run();
    nextHead();
    // The precompute's first member check fails; the request's own reads succeed.
    state.failChecks = { count: 1, error: internalError };
    const precompute = precomputeSignatureSets(state.head);
    const set = await run();
    expect(set.thresholdCheck.status).toBe("met");
    expect(await precompute).toMatchObject({ failed: 1 });
    // Its result is kept: the next request at this head asks nothing.
    const sent = posts();
    expect(await run()).toBe(set);
    expect(posts()).toBe(sent);
  });

  // While a set is being computed, the listings it read can change or turn 60 s old: whoever
  // joins that computation takes its result only if it still stands for what the store serves
  // when it ends, and otherwise reads Safe itself, as it would have without it.
  describe("a computation in flight", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** The third member signs: the store now serves a new version of the listings. */
    const thirdSigns = () => {
      inSafe(MEMBERS[2] as Hex, "0x02");
      state.valid.add(`${MEMBERS[2]}:0x02`);
      state.listingVersion = 2;
    };

    it("is taken while its listings are still served: no Safe read of the request's own", async () => {
      twoSigned();
      await run();
      nextHead();
      state.delay = 120;
      const precompute = precomputeSignatureSets(state.head);
      // The precompute has read the listings; its eth_calls are in flight.
      await sleep(40);
      const lookups = state.lookups;
      state.demand = [];
      const set = await run();
      expect(state.lookups).toBe(lookups);
      expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
      expect(await precompute).toMatchObject({ verified: 1 });
      // The precompute's result, kept: the next request at this head gets the same object.
      expect(await run()).toBe(set);
      // Both pages count as asking for the member Safes (the sweep keeps them fresh).
      const all = MEMBERS.map((m) => m.toLowerCase()).sort();
      expect(state.demand.map((safes) => [...safes].sort())).toEqual([all, all]);
    });

    it("is not taken when a listing it read is replaced meanwhile: the request reads Safe and sees the new signature", async () => {
      twoSigned();
      await run();
      nextHead();
      state.delay = 120;
      const precompute = precomputeSignatureSets(state.head);
      await sleep(40);
      thirdSigns();
      const lookups = state.lookups;
      const set = await run();
      expect(state.lookups - lookups).toBe(MEMBERS.length);
      expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "valid"]);
      await precompute;
      // The request's result is the one kept.
      expect(await run()).toBe(set);
    });

    it("is not taken when its listings turn 60 s old meanwhile: the request reads them again", async () => {
      twoSigned();
      await run();
      nextHead();
      state.delay = 120;
      const precompute = precomputeSignatureSets(state.head);
      await sleep(40);
      state.listingFresh = false;
      const lookups = state.lookups;
      await run();
      expect(state.lookups - lookups).toBe(MEMBERS.length);
      await precompute;
    });

    it("of another request is not taken when a listing it read is replaced meanwhile", async () => {
      twoSigned();
      state.delay = 120;
      const first = run();
      await sleep(40);
      thirdSigns();
      const lookups = state.lookups;
      const second = await run();
      expect((await first).members[2]?.status).toBe("missing");
      expect(second.members[2]?.status).toBe("valid");
      expect(state.lookups - lookups).toBe(MEMBERS.length);
    });

    it("is not taken when a member's Safe info is read again meanwhile", async () => {
      twoSigned();
      await run();
      nextHead();
      state.delay = 120;
      const precompute = precomputeSignatureSets(state.head);
      await sleep(40);
      // The engine re-reads a member Safe's info before it expires: the owners now need two.
      const { safeInfo } = await import("@/.server/governance");
      const info = await safeInfo(MEMBERS[0] as Address);
      replace(
        `safe-info:${(MEMBERS[0] as string).toLowerCase()}`,
        { ...info, threshold: 2 },
        5 * 60_000
      );
      const lookups = state.lookups;
      const set = await run();
      expect(state.lookups - lookups).toBe(MEMBERS.length);
      await precompute;
      expect(await run()).toBe(set);
    });
  });

  it("a kept set no longer stands once a member's Safe info is read again", async () => {
    twoSigned();
    const first = await run();
    expect(await run()).toBe(first);
    const { safeInfo } = await import("@/.server/governance");
    const info = await safeInfo(MEMBERS[1] as Address);
    // As the sync engine does before the entry expires: the same info, read again.
    replace(`safe-info:${(MEMBERS[1] as string).toLowerCase()}`, { ...info }, 5 * 60_000);
    const lookups = state.lookups;
    const again = await run();
    expect(again).not.toBe(first);
    expect(state.lookups - lookups).toBe(MEMBERS.length);
    expect(await run()).toBe(again);
  });

  it("a page answered from a kept set still counts as asking for its member Safes", async () => {
    twoSigned();
    await run();
    expect(state.demand).toEqual([]);
    await run();
    expect(state.demand).toEqual([MEMBERS.map((m) => m.toLowerCase())]);
    // A precompute is not a page.
    await precomputeSignatureSets(nextHead());
    expect(state.demand).toHaveLength(1);
  });

  // What is never kept, whatever else holds.
  describe("never kept", () => {
    it("the threshold verdict on a set holding a supplied signature, even next to Safe's", async () => {
      inSafe(MEMBERS[0] as Hex, "0x00");
      state.valid.add(`${MEMBERS[0]}:0x00`);
      state.valid.add(`${MEMBERS[1]}:0xcc`);
      const supplied = [{ signer: MEMBERS[1] as Hex, signature: "0xcc" as Hex }];
      expect((await run(2, supplied)).thresholdCheck.status).toBe("met");
      expect((await run(2, supplied)).thresholdCheck.status).toBe("met");
      // The combined check was asked each time: nothing about the supplied signature is stored.
      expect(state.combined).toBe(2);
    });

    it("a set whose Safe reads failed: the next request at that head reads Safe again", async () => {
      twoSigned();
      state.safeApiDown = true;
      expect((await run()).members.map((m) => m.status)).toEqual([
        "unavailable",
        "unavailable",
        "unavailable",
      ]);
      state.safeApiDown = false;
      const lookups = state.lookups;
      const set = await run();
      expect(state.lookups - lookups).toBe(MEMBERS.length);
      expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    });

    it("a set whose messages were looked up by hash (no listing version to tell when it changes)", async () => {
      twoSigned();
      state.byHash = true;
      await run();
      await run();
      expect(state.lookups).toBe(2 * MEMBERS.length);
    });

    it("a set past a minute, though the head and the listings are unchanged", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      twoSigned();
      const first = await run();
      vi.setSystemTime(Date.now() + 59_000);
      expect(await run()).toBe(first);
      vi.setSystemTime(Date.now() + 2_000);
      const lookups = state.lookups;
      expect(await run()).not.toBe(first);
      expect(state.lookups - lookups).toBe(MEMBERS.length);
    });

    it("a precompute across a settings change: no result, no further sets, no last run", async () => {
      twoSigned();
      // Five watched sets (one more than the precompute verifies at once).
      for (let threshold = 1; threshold <= 5; threshold++) await run(threshold);
      const head = nextHead();
      state.delay = 60;
      let generation = 1;
      const precompute = precomputeSignatureSets(head, { current: () => generation === 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The settings change: every cache is emptied and the generation moves on.
      clearCache();
      generation = 2;
      expect(await precompute).toMatchObject({ sets: 5, skipped: 1 });
      expect(signatureSetsStatus().lastRun).toBeNull();
      // Nothing the precompute computed was kept: a request at that head verifies on its own.
      const lookups = state.lookups;
      await run(2);
      expect(state.lookups - lookups).toBe(MEMBERS.length);
    });
  });

  it("a block at the same height on another branch is another entry", async () => {
    twoSigned();
    await run();
    const sent = posts();
    expect(codeReads()).toBe(1);
    nextHead(`0x${"b1".repeat(32)}`, 1_100n);
    const set = await run();
    expect(posts()).toBeGreaterThan(sent);
    expect(set.thresholdCheck.status).toBe("met");
    // Each member was asked twice at block 1,100: once per block hash.
    expect(state.checked.filter((c) => c === `${MEMBERS[0]}:0x00@0x44c`)).toHaveLength(2);
    // The council's code too: presence learned at one block is not lent to its sibling.
    expect(codeReads()).toBe(2);
  });

  it("asks a pinned read once more when the node does not know the head yet, then fails as an upstream error", async () => {
    twoSigned();
    const headerNotFound = () => new FakeRpcError(-32000, "header not found");
    // The first member check finds a backend that has not seen block 1,100 yet.
    state.failChecks = { count: 1, error: headerNotFound };
    expect((await run()).thresholdCheck.status).toBe("met");
    expect(state.attempts).toBe(3);
    // A backend that keeps not knowing it: each read asked twice, then an upstream error, never
    // "invalid".
    clearCache();
    state.attempts = 0;
    state.failChecks = { count: Number.POSITIVE_INFINITY, error: headerNotFound };
    await expect(run()).rejects.toBeInstanceOf(UpstreamError);
    expect(state.attempts).toBe(4);
  });

  /** A page views set `n` (one per upgrade id), open (still signable) or not. */
  const view = (n: number, open = false) =>
    verifySignatureSet({
      action: "ApproveUpgradeSecurityCouncil",
      signerGroup: "securityCouncil",
      typedData: buildTypedData("ApproveUpgradeSecurityCouncil", typedData.domain, {
        id: `0x${n.toString(16).padStart(64, "0")}`,
      }),
      members: MEMBERS,
      threshold: 2,
      check: { kind: "multisig", contract: COUNCIL },
      open,
    });

  it("remembers at most 256 sets, each for 24 hours after it was last viewed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let n = 1; n <= 257; n++) await view(n, n % 2 === 0);
    expect(signatureSetsStatus()).toMatchObject({ watched: 256, recent: 256, open: 128 });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await view(257);
    // Past 10 minutes: no longer recent, still remembered (its last result is known).
    vi.setSystemTime(Date.now() + 60_001);
    expect(signatureSetsStatus()).toMatchObject({ watched: 256, recent: 1, open: 128 });
    // 24 hours after the first views (set 257 was viewed again 9 minutes later).
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000 - 10 * 60_000);
    expect(signatureSetsStatus()).toMatchObject({ watched: 1, recent: 0, open: 0 });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    expect(signatureSetsStatus()).toMatchObject({ watched: 0, recent: 0, open: 0 });
  });

  it("precomputes while the app is in use the sets viewed in the last 10 minutes and the open ones; while idle only the open ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    twoSigned();
    // Set 1 is open (e.g. an upgrade waiting for the council), set 2 is done.
    await view(1, true);
    await view(2, false);
    const h2 = nextHead();
    expect(await precomputeSignatureSets(h2, { viewing: false })).toMatchObject({
      block: "1101",
      profile: "idle",
      sets: 1,
      verified: 1,
    });
    expect(await precomputeSignatureSets(h2, { viewing: true })).toMatchObject({
      profile: "viewing",
      sets: 2,
      verified: 1,
      reused: 1,
    });
    // Eleven minutes later, still in use: the done set was not viewed again, the open one stays.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await precomputeSignatureSets(nextHead(`0x${"a3".repeat(32)}`), {})).toMatchObject({
      profile: "viewing",
      sets: 1,
      verified: 1,
    });
    // A later view that finds it closed takes it out of the idle precompute.
    await view(1, false);
    expect(
      await precomputeSignatureSets(nextHead(`0x${"a4".repeat(32)}`), { viewing: false })
    ).toMatchObject({ sets: 0 });
  });

  it("precomputes at most the 16 most recently viewed open sets, and 64 recent ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let n = 1; n <= 20; n++) await view(n, true);
    for (let n = 101; n <= 170; n++) await view(n, false);
    const head = nextHead();
    expect(await precomputeSignatureSets(head, { viewing: false })).toMatchObject({ sets: 16 });
    expect(await precomputeSignatureSets(head, { viewing: true })).toMatchObject({
      sets: 16 + 64,
    });
  });

  it("verifies again on a listing change only the sets the current profile covers", async () => {
    twoSigned();
    await view(1, false);
    let viewing = false;
    startSignatureWatch({
      active: () => true,
      viewing: () => viewing,
      head: () => Promise.resolve(state.head),
    });
    // Idle: the done set is not verified again when a member's listing changes.
    state.listingVersion = 2;
    for (const listener of state.listeners) listener((MEMBERS[2] as string).toLowerCase());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signatureSetsStatus().lastRun).toBeNull();
    // In use: it is.
    viewing = true;
    state.listingVersion = 3;
    for (const listener of state.listeners) listener((MEMBERS[2] as string).toLowerCase());
    await vi.waitFor(() =>
      expect(signatureSetsStatus().lastRun).toMatchObject({
        trigger: "safe",
        profile: "viewing",
        sets: 1,
        verified: 1,
      })
    );
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

  describe("kept per head", () => {
    const H2 = { number: 1_101n, hash: `0x${"a2".repeat(32)}` as Hex };

    it("asks once per head, at its number; a definite answer is kept, an RPC failure is not", async () => {
      let reply: unknown = "0x";
      const fake = fakeCallLane(() => reply);
      state.lane = fake.lane;
      expect(await simulate(execution, { keep: true })).toEqual({ status: "ok" });
      expect(await simulate(execution, { keep: true })).toEqual({ status: "ok" });
      expect(fake.calls().map((c) => c.params[1])).toEqual(["0x44c"]);
      // Without keep (a supplied signature in it): at 'latest', every time.
      await simulate(execution);
      expect(fake.calls().map((c) => c.params[1])).toEqual(["0x44c", "latest"]);

      state.head = { ...state.head, ...H2 };
      reply = revertWith("Protocol frozen");
      const reverted = { status: "reverted", error: "Protocol frozen" };
      expect(await simulate(execution, { keep: true })).toEqual(reverted);
      expect(await simulate(execution, { keep: true })).toEqual(reverted);
      expect(fake.calls()).toHaveLength(3);

      state.head = { ...state.head, number: 1_102n, hash: `0x${"a3".repeat(32)}` };
      reply = internalError();
      expect(await simulate(execution, { keep: true })).toMatchObject({ status: "skipped" });
      reply = "0x";
      expect(await simulate(execution, { keep: true })).toEqual({ status: "ok" });
      expect(fake.calls()).toHaveLength(5);
    });

    it("tells apart senders, values and calldata, and asks once more when the node does not know the head", async () => {
      let notFound = 1;
      const fake = fakeCallLane(() =>
        notFound-- > 0 ? new FakeRpcError(-32000, "header not found") : "0x"
      );
      state.lane = fake.lane;
      expect(await simulate(execution, { keep: true })).toEqual({ status: "ok" });
      expect(fake.calls()).toHaveLength(2);
      await simulate({ ...execution, value: "7" }, { keep: true });
      await simulate({ ...execution, data: "0x5678" }, { keep: true });
      await simulateCall(
        { from: MEMBERS[0] as Address, to: COUNCIL, data: "0x1234" },
        { keep: true }
      );
      expect(fake.calls()).toHaveLength(5);
    });

    it("on a dev node: at 'latest', never kept", async () => {
      state.devNode = true;
      const fake = fakeCallLane(() => "0x");
      state.lane = fake.lane;
      await simulate(execution, { keep: true });
      await simulate(execution, { keep: true });
      expect(fake.calls().map((c) => c.params[1])).toEqual(["latest", "latest"]);
    });
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
