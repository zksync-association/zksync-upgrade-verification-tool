import { clearCache } from "@/.server/cache";
import type { Lane } from "@/.server/chain/jsonrpc";
import { guardiansAbi, safeAbi, securityCouncilAbi } from "@/common/abis";
import {
  type Address,
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  type Hex,
  HttpRequestError,
  InternalRpcError,
  RawContractError,
  RpcRequestError,
  zeroHash,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HARDHAT_VERSION,
  RawResult,
  SECRET_URL,
  contracts,
  errorData,
  fakeCallLane,
  hardhatError,
  internalError,
  outOfGas,
  panicData,
  panicWith,
  revertWith,
} from "../support/fake-calls";
import { type FakeCall, type FakeOptions, FakeRpcError } from "../support/fake-jsonrpc";

// chain/call.ts: what a failed eth_call means. Only a definite revert (code 3, or -32000
// "execution reverted" without out-of-gas text) is an answer; everything else is an upstream
// failure, whatever its shape.

const state = vi.hoisted(() => ({
  lane: null as Lane | null,
  network: { isDevNode: false } as { isDevNode: boolean; clientVersion?: string } | Error,
  // The finality boundary F, or the error reading it fails with.
  safe: 1_000n as bigint | Error,
  // What the boundary read waits for before answering (null: nothing).
  boundaryGate: null as (() => Promise<unknown>) | null,
}));
vi.mock("@/.server/rpc", () => ({
  lanes: () => ({ call: state.lane }),
  network: async () => {
    if (state.network instanceof Error) throw state.network;
    return state.network;
  },
  safeBlockNumber: async () => {
    await state.boundaryGate?.();
    if (state.safe instanceof Error) throw state.safe;
    return state.safe;
  },
}));

const {
  CallReverted,
  NoContract,
  UndecodableResult,
  UpstreamError,
  callFn,
  classify,
  ethCall,
  isFinalBlock,
  requireCode,
  revertDialect,
} = await import("@/.server/chain/call");
const { readMemberList } = await import("@/.server/member-list");

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const COUNCIL: Address = "0x59195219d1176E42f8e607e9AC114926D47f9035";
const EMPTY: Address = "0x00000000000000000000000000000000000000e0";
const SIGNER: Address = "0x1000000000000000000000000000000000000001";

/** A lane whose upstream answers every eth_call with `reply`. */
function answering(reply: (call: FakeCall) => unknown, options: Omit<FakeOptions, "handle"> = {}) {
  const fake = fakeCallLane(reply, options);
  state.lane = fake.lane;
  return fake;
}

const checkSignatures = (blockNumber?: bigint, address: Address = COUNCIL) =>
  callFn({
    address,
    abi: guardiansAbi,
    functionName: "checkSignatures",
    args: [zeroHash, [SIGNER], ["0xaa"], 1n],
    blockNumber,
  });

const isValidSignature = (address: Address = COUNCIL) =>
  callFn<Hex>({
    address,
    abi: safeAbi,
    functionName: "isValidSignature",
    args: [zeroHash, "0xaa"],
  });

/** The error a promise rejects with. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  clearCache();
  state.network = { isDevNode: false };
  state.safe = 1_000n;
  state.boundaryGate = null;
});

describe("classify", () => {
  it.each([
    [{ code: 3, message: "execution reverted", data: "0x08c379a0" }, "revert"],
    [{ code: 3, message: "execution reverted: GS026" }, "revert"],
    [{ code: -32000, message: "execution reverted" }, "revert"],
    [{ code: -32000, message: "execution reverted: Signature verification failed" }, "revert"],
    [{ code: -32000, message: "out of gas" }, "upstream"],
    [{ code: -32000, message: "gas required exceeds allowance (50000000)" }, "upstream"],
    [{ code: -32000, message: "execution reverted: out of gas" }, "upstream"],
    // Code 3 itself means "reverted": its message is the contract's own reason, whatever it says.
    [{ code: 3, message: "execution reverted: gas limit reached" }, "revert"],
    [
      { code: 3, message: "execution reverted: out of gas", data: errorData("out of gas") },
      "revert",
    ],
    [{ code: -32603, message: "internal error" }, "upstream"],
    [{ code: -32603, message: "execution reverted" }, "upstream"],
    [{ code: -32000, message: "header not found" }, "upstream"],
    [{ code: -32000, message: "missing trie node" }, "upstream"],
    [{ code: -32005, message: "request rate exceeded" }, "upstream"],
    [{ code: 429, message: "Too Many Requests" }, "upstream"],
    [{ code: -32602, message: "invalid argument" }, "upstream"],
  ])("raw JSON-RPC error %o → %s", (error, expected) => {
    expect(classify(error)).toBe(expected);
  });

  it("walks viem errors for the node's code; a Multicall3 sub-call failure is never definite", () => {
    const rpc = (code: number, message: string) =>
      new RpcRequestError({ body: {}, error: { code, message }, url: "http://rpc" });
    // eth_call through viem: CallExecutionError ← ExecutionRevertedError ← RpcRequestError(3).
    const reverted = new CallExecutionError(
      new ExecutionRevertedError({ cause: rpc(3, "execution reverted: GS026") }),
      {}
    );
    expect(classify(reverted)).toBe("revert");
    expect(classify(new InternalRpcError(rpc(-32603, "execution reverted")))).toBe("upstream");
    // aggregate3 (success=false, 0x): an out-of-gas sub-call looks exactly like this.
    expect(classify(new RawContractError({ data: "0x" }))).toBe("upstream");
    expect(
      classify(
        new ContractFunctionExecutionError(new RawContractError({ data: "0x" }) as never, {
          abi: [],
          functionName: "checkSignatures",
        })
      )
    ).toBe("upstream");
    // What viem's readContract makes of code 3, -32603 and aggregate3 alike: no code survives.
    expect(
      classify(new ContractFunctionRevertedError({ abi: [], functionName: "f", message: "x" }))
    ).toBe("upstream");
    expect(classify(new HttpRequestError({ url: "http://rpc", status: 500 }))).toBe("upstream");
    expect(classify(new Error("socket hang up"))).toBe("upstream");
    expect(classify(undefined)).toBe("upstream");
  });
});

describe("ethCall over the call lane", () => {
  it("sends one plain eth_call with from, value, block and state override", async () => {
    const fake = answering(() => "0x01");
    expect(
      await ethCall({
        to: COUNCIL,
        data: "0x1234",
        from: SIGNER,
        value: 5n,
        blockNumber: 100n,
        stateOverride: [{ address: SIGNER, balance: 10n }],
      })
    ).toBe("0x01");
    expect(fake.calls()).toHaveLength(1);
    expect(fake.calls()[0]?.params).toEqual([
      { to: COUNCIL, data: "0x1234", from: SIGNER, value: "0x5" },
      "0x64",
      { [SIGNER]: { balance: "0xa" } },
    ]);
    await ethCall({ to: COUNCIL, data: "0x1234" });
    expect(fake.calls()[1]?.params).toEqual([{ to: COUNCIL, data: "0x1234" }, "latest"]);
  });

  it("reports a code-3 revert with its Error(string) reason and data", async () => {
    const reply = revertWith("Signature verification failed");
    answering(() => reply);
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(CallReverted);
    expect(error).toMatchObject({
      reason: "Signature verification failed",
      data: reply.data,
      code: 3,
    });
    expect(classify(error)).toBe("revert");
  });

  it("names a Panic, and falls back to the node's message for an empty revert", async () => {
    answering(() => panicWith(0x32n));
    expect(await failure(ethCall({ to: COUNCIL, data: "0x" }))).toMatchObject({
      reason: "Panic(0x32)",
    });
    answering(() => new FakeRpcError(-32000, "execution reverted"));
    expect(await failure(ethCall({ to: COUNCIL, data: "0x" }))).toMatchObject({
      reason: "execution reverted",
      data: "0x",
    });
    answering(() => new FakeRpcError(3, "execution reverted: GS026", { data: "0x" }));
    expect(await failure(ethCall({ to: COUNCIL, data: "0x" }))).toMatchObject({
      reason: "execution reverted: GS026",
    });
  });

  it.each([
    ["out of gas (-32000)", () => outOfGas()],
    ["internal error (-32603)", () => internalError()],
    ["-32603 that says reverted", () => new FakeRpcError(-32603, "execution reverted")],
    ["missing state (-32000)", () => new FakeRpcError(-32000, "missing trie node abc")],
  ])("reports %s as an upstream failure, never a revert", async (_name, reply) => {
    answering(reply);
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).not.toBeInstanceOf(CallReverted);
    expect(classify(error)).toBe("upstream");
  });

  it.each([
    ["HTTP 429", () => new Response("Too Many Requests", { status: 429 })],
    ["HTTP 500", () => new Response(`upstream ${SECRET_URL} failed`, { status: 500 })],
    ["HTTP 403", () => new Response("forbidden", { status: 403 })],
  ])("reports %s as an upstream failure", async (_name, response) => {
    answering(() => "0x", { intercept: () => response() });
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(classify(error)).toBe("upstream");
    expect(String((error as Error).message)).not.toContain("secret-host");
    expect(String((error as Error).message)).not.toContain("0123456789abcdef");
  });

  it("reports a timeout and a network failure as upstream failures", async () => {
    // The upstream never answers; the lane's 200 ms timeout aborts the POST.
    answering(() => "0x", { delayMs: 60_000 });
    const timedOut = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(timedOut).toBeInstanceOf(UpstreamError);
    expect((timedOut as Error).message).toMatch(/timed out/);

    const { createLane } = await import("@/.server/chain/jsonrpc");
    state.lane = createLane({
      url: SECRET_URL,
      label: "l1-call",
      maxBatch: 20,
      maxInFlight: 8,
      retries: 0,
      fetch: async () => {
        throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
      },
    });
    const offline = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(offline).toBeInstanceOf(UpstreamError);
    expect(classify(offline)).toBe("upstream");
    expect((offline as Error).message).not.toContain("secret-host");
  });

  it("keeps the URL and key out of every error, also inside a revert", async () => {
    answering(() => new FakeRpcError(-32603, `internal error at ${SECRET_URL}`));
    const internal = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    answering(() => new FakeRpcError(3, `execution reverted: see ${SECRET_URL}`));
    const reverted = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    for (const error of [internal, reverted]) {
      const text = `${(error as Error).message} ${(error as { reason?: string }).reason ?? ""}`;
      expect(text).not.toContain("secret-host");
      expect(text).not.toContain("0123456789abcdef");
    }
  });

  it("never sends a call through Multicall3", async () => {
    const fake = answering(contracts({ abis: [guardiansAbi], call: () => undefined }));
    await checkSignatures();
    expect(fake.calls().every((c) => (c.params[0] as { to: string }).to !== MULTICALL3)).toBe(true);
  });
});

describe("callFn", () => {
  it("accepts a void success only where the contract has code, at the same block", async () => {
    const codeAt: [Address, string][] = [];
    answering(
      contracts({
        abis: [guardiansAbi],
        call: () => undefined,
        code: (address, block) => {
          codeAt.push([address, block]);
          return address === EMPTY ? "0x" : "0x6080";
        },
      })
    );
    expect(await checkSignatures(42n)).toBeUndefined();
    expect(codeAt).toEqual([[COUNCIL, "0x2a"]]);

    const error = await failure(checkSignatures(undefined, EMPTY));
    expect(error).toBeInstanceOf(NoContract);
    expect(classify(error)).toBe("upstream");
  });

  it("reports a definite revert of a void function", async () => {
    answering(
      contracts({ abis: [guardiansAbi], call: () => revertWith("Signature verification failed") })
    );
    expect(await failure(checkSignatures())).toMatchObject({
      name: "CallReverted",
      reason: "Signature verification failed",
    });
  });

  it("refuses empty or undecodable data for a function with outputs", async () => {
    let answer: unknown = new RawResult("0x");
    answering(contracts({ abis: [safeAbi], call: () => answer }));
    const empty = await failure(isValidSignature(EMPTY));
    expect(empty).toBeInstanceOf(UndecodableResult);
    expect(classify(empty)).toBe("upstream");

    answer = new RawResult("0x1234");
    expect(await failure(isValidSignature())).toBeInstanceOf(UndecodableResult);

    answer = "0x1626ba7e";
    expect(await isValidSignature()).toBe("0x1626ba7e");
  });

  it("decodes several outputs", async () => {
    answering(
      contracts({
        abis: [guardiansAbi],
        call: () => ["0x0f", "Guardians", "1", 1n, COUNCIL, zeroHash, []],
      })
    );
    const domain = await callFn<readonly unknown[]>({
      address: COUNCIL,
      abi: guardiansAbi,
      functionName: "eip712Domain",
    });
    expect(domain.slice(1, 5)).toEqual(["Guardians", "1", 1n, COUNCIL]);
  });
});

describe("requireCode", () => {
  const counting = (code: (address: Address) => Hex) => {
    let reads = 0;
    answering(
      contracts({
        abis: [],
        call: () => undefined,
        code: (address) => {
          reads++;
          return code(address);
        },
      })
    );
    return () => reads;
  };

  it("keeps presence for a minute at 'latest' and for good at a final block", async () => {
    const reads = counting(() => "0x6080");
    await requireCode(COUNCIL);
    await requireCode(COUNCIL);
    expect(reads()).toBe(1);
    await requireCode(COUNCIL, 900n);
    await requireCode(COUNCIL, 900n);
    expect(reads()).toBe(2);
    expect(await isFinalBlock(900n)).toBe(true);
    expect(await isFinalBlock(1_001n)).toBe(false);
  });

  it("never keeps absence, and never treats a dev node's block as final", async () => {
    const reads = counting(() => "0x");
    await expect(requireCode(EMPTY)).rejects.toBeInstanceOf(NoContract);
    await expect(requireCode(EMPTY)).rejects.toBeInstanceOf(NoContract);
    expect(reads()).toBe(2);
    state.network = { isDevNode: true };
    expect(await isFinalBlock(1n)).toBe(false);
  });

  it("reads presence again after a minute at 'latest' and above the boundary, never when final", async () => {
    const reads = counting(() => "0x6080");
    const all = () =>
      Promise.all([requireCode(COUNCIL), requireCode(COUNCIL, 1_001n), requireCode(COUNCIL, 900n)]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await all();
      expect(reads()).toBe(3);
      vi.setSystemTime(Date.now() + 59_000);
      await all();
      expect(reads()).toBe(3);
      vi.setSystemTime(Date.now() + 2_000);
      await all();
      // 'latest' and block 1,001 (above F = 1,000) again; block 900 is final and kept.
      expect(reads()).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails on an upstream error instead of reporting no contract", async () => {
    answering((call) => (call.method === "eth_getCode" ? internalError() : "0x"));
    const error = await failure(requireCode(COUNCIL));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).not.toBeInstanceOf(NoContract);
  });
});

describe("finality", () => {
  it("counts a block as not final when the boundary cannot be read, and never rejects", async () => {
    state.safe = new UpstreamError("head unavailable");
    expect(await isFinalBlock(1n)).toBe(false);
    state.safe = 1_000n;
    state.network = new UpstreamError("chain id unavailable");
    expect(await isFinalBlock(1n)).toBe(false);
  });

  it("reads the boundary before the code: a block that turns final meanwhile is not kept", async () => {
    // Block 900 is above F (899) until the code is read, then F moves to 1,000. The boundary read
    // answers once the code is read, or after 50 ms when it has to come first.
    let reads = 0;
    let answered = () => {};
    const codeRead = new Promise<void>((resolve) => {
      answered = resolve;
    });
    answering(
      contracts({
        abis: [],
        call: () => undefined,
        code: () => {
          reads++;
          state.safe = 1_000n;
          answered();
          return "0x6080";
        },
      })
    );
    state.safe = 899n;
    state.boundaryGate = () =>
      Promise.race([codeRead, new Promise((resolve) => setTimeout(resolve, 50))]);
    await requireCode(COUNCIL, 900n);
    state.boundaryGate = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      await requireCode(COUNCIL, 900n);
      // Read while block 900 was not final: kept a minute only, so read again.
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still answers requireCode at a past block when finality is unknown, without keeping it", async () => {
    let reads = 0;
    answering(
      contracts({
        abis: [],
        call: () => undefined,
        code: () => {
          reads++;
          return "0x6080";
        },
      })
    );
    state.safe = new UpstreamError("head unavailable");
    await requireCode(COUNCIL, 900n);
    expect(reads).toBe(1);
    // Not known final, so kept a minute at most (here: still within it).
    state.safe = 1_000n;
    await requireCode(COUNCIL, 900n);
    expect(reads).toBe(1);
  });
});

// Hardhat and Ganache report eth_call reverts their own way. Each Hardhat shape below was measured
// on a local Hardhat 2.22.9 node (hardhat_setCode stubs, and a fork of a local fake upstream that
// fails); the Ganache shapes follow its CallError (-32000 "VM Exception while processing
// transaction: revert", revert bytes as data).
describe("dev-node revert dialects", () => {
  const HARDHAT = { isDevNode: true, clientVersion: HARDHAT_VERSION };
  const GANACHE = {
    isDevNode: true,
    clientVersion: "Ganache/v7.9.2/EthereumJS TestRPC/v7.9.2/ethereum-js",
  };
  const PANIC_32 =
    "VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)";

  it("applies only to a dev node that names itself", () => {
    expect(revertDialect(HARDHAT)).toBe("hardhat");
    expect(revertDialect(GANACHE)).toBe("ganache");
    expect(revertDialect({ isDevNode: false, clientVersion: HARDHAT_VERSION })).toBe("standard");
    expect(revertDialect({ isDevNode: true, clientVersion: "anvil/v0.2.0" })).toBe("standard");
    expect(revertDialect({ isDevNode: true })).toBe("standard");
  });

  it.each([
    [
      "an empty revert",
      hardhatError("Transaction reverted without a reason string", "0x"),
      "Error: Transaction reverted without a reason string",
    ],
    [
      "Error(string)",
      hardhatError(
        "VM Exception while processing transaction: reverted with reason string 'Nope'",
        errorData("Nope")
      ),
      "Nope",
    ],
    ["Panic(0x32)", hardhatError(PANIC_32, panicData(0x32n)), "Panic(0x32)"],
    [
      "an unknown custom error",
      hardhatError(
        "VM Exception while processing transaction: reverted with an unrecognized custom error (return data: 0xdeadbeef)",
        "0xdeadbeef"
      ),
      "Error: VM Exception while processing transaction: reverted with an unrecognized custom error (return data: 0xdeadbeef)",
    ],
    [
      "a dispatcher revert",
      hardhatError(
        "Transaction reverted: function selector was not recognized and there's no fallback function",
        "0x"
      ),
      "Error: Transaction reverted: function selector was not recognized and there's no fallback function",
    ],
  ])("on Hardhat, %s (-32603) is a definite revert", async (_name, reply, reason) => {
    state.network = HARDHAT;
    answering(() => reply);
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(CallReverted);
    expect(error).toMatchObject({ reason, code: -32603 });
    expect(classify(error)).toBe("revert");
  });

  it.each([
    ["a failed fork upstream", hardhatError("task 486 panicked")],
    [
      "an invalid opcode",
      hardhatError("VM Exception while processing transaction: invalid opcode", "0x"),
    ],
    [
      "out of gas",
      new FakeRpcError(-32000, "Transaction ran out of gas", {
        message: "Transaction ran out of gas",
        txHash: null,
        data: "0x",
      }),
    ],
    [
      "'reverted' without revert bytes",
      hardhatError("Transaction reverted without a reason string"),
    ],
    // Fails safe: the node's words and the contract's are one message here.
    [
      "a revert whose reason mentions gas",
      hardhatError(
        "VM Exception while processing transaction: reverted with reason string 'out of gas'",
        errorData("out of gas")
      ),
    ],
    ["a plain internal error", internalError()],
  ])("on Hardhat, %s is an upstream failure", async (_name, reply) => {
    state.network = HARDHAT;
    answering(() => reply);
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(classify(error)).toBe("upstream");
  });

  it.each([
    ["a node that is not a dev node", { isDevNode: false, clientVersion: HARDHAT_VERSION }],
    ["anvil", { isDevNode: true, clientVersion: "anvil/v0.2.0" }],
    ["a node whose version is unknown", new UpstreamError("web3_clientVersion failed")],
  ])("never reads Hardhat's shape as a revert from %s", async (_name, network) => {
    state.network = network;
    answering(() => hardhatError(PANIC_32, panicData(0x32n)));
    expect(await failure(ethCall({ to: COUNCIL, data: "0x" }))).toBeInstanceOf(UpstreamError);
  });

  it("ends a member list on Hardhat, and still fails it on Hardhat's own failure", async () => {
    // The app's own path: readMemberList over callFn, members(0..1) then out of bounds.
    state.network = HARDHAT;
    let failAt: number | null = null;
    answering(
      contracts({
        abis: [securityCouncilAbi],
        call: (call) => {
          const index = Number(call.args[0]);
          if (index === failAt) return hardhatError("task 486 panicked");
          return index < 2 ? SIGNER : hardhatError(PANIC_32, panicData(0x32n));
        },
      })
    );
    const members = () =>
      readMemberList((index) =>
        callFn<Address>({
          address: COUNCIL,
          abi: securityCouncilAbi,
          functionName: "members",
          args: [index],
        })
      );
    expect(await members()).toEqual([SIGNER, SIGNER]);
    failAt = 1;
    await expect(members()).rejects.toBeInstanceOf(UpstreamError);
  });

  it.each<[{ code: number; message: string; data?: string }, "revert" | "upstream"]>([
    [
      { code: -32000, message: "VM Exception while processing transaction: revert", data: "0x" },
      "revert",
    ],
    [
      {
        code: -32000,
        message: "VM Exception while processing transaction: revert Nope",
        data: errorData("Nope"),
      },
      "revert",
    ],
    [
      {
        code: -32000,
        message: "VM Exception while processing transaction: out of gas",
        data: "0x",
      },
      "upstream",
    ],
    [{ code: -32000, message: "VM Exception while processing transaction: revert" }, "upstream"],
    [
      {
        code: -32000,
        message: "VM Exception while processing transaction: revert out of gas",
        data: "0x",
      },
      "upstream",
    ],
    [
      { code: -32603, message: "VM Exception while processing transaction: revert", data: "0x" },
      "upstream",
    ],
  ])("on Ganache, %o is %s", async (shape, expected) => {
    expect(classify(shape, "ganache")).toBe(expected);
    // The standard rule never takes Ganache's word for it.
    expect(classify(shape)).toBe("upstream");
    state.network = GANACHE;
    answering(() => new FakeRpcError(shape.code, shape.message, shape.data));
    const error = await failure(ethCall({ to: COUNCIL, data: "0x" }));
    expect(error).toBeInstanceOf(expected === "revert" ? CallReverted : UpstreamError);
  });
});
