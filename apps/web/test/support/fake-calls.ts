import { type Lane, createLane } from "@/.server/chain/jsonrpc";
import {
  type Abi,
  type Address,
  type Hex,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  hexToBigInt,
  parseAbi,
} from "viem";
import { type FakeCall, type FakeOptions, FakeRpcError, fakeJsonRpc } from "./fake-jsonrpc";

// Contracts behind a fake upstream for the direct eth_call path (chain/call.ts) through a real
// lane: each eth_call is decoded against the given ABIs and answered by the test. No network.

/** An RPC URL with a "key" in it: no error the app produces may contain either. */
export const SECRET_URL = "https://rpc.secret-host.test/v3/0123456789abcdef0123456789abcdef";

export type ContractCall = {
  to: Address;
  from: Address | undefined;
  value: bigint | undefined;
  /** "latest" or the block number as hex. */
  block: string;
  stateOverride: Record<string, { balance?: Hex }> | undefined;
  functionName: string;
  args: readonly unknown[];
};

/** Answers an eth_call with these exact bytes (e.g. "0x" for a function with outputs). */
export class RawResult {
  constructor(readonly data: Hex) {}
}

export type ContractAnswer = unknown | FakeRpcError | RawResult;

const errorAbi = parseAbi(["error Error(string)", "error Panic(uint256)"]);

/** A definite revert with an Error(string) reason, as geth and anvil send it (code 3). */
export const revertWith = (reason: string) =>
  new FakeRpcError(
    3,
    `execution reverted: ${reason}`,
    encodeErrorResult({ abi: errorAbi, errorName: "Error", args: [reason] })
  );

/** A definite revert with a Panic code (0x32: index out of bounds), as geth sends it (code 3). */
export const panicWith = (code: bigint) =>
  new FakeRpcError(
    3,
    "execution reverted",
    encodeErrorResult({ abi: errorAbi, errorName: "Panic", args: [code] })
  );

/** What an RPC node sends when it fails internally: never an answer about the contract. */
export const internalError = () => new FakeRpcError(-32603, "internal error");

/** A call that ran out of gas: never an answer about the contract either. */
export const outOfGas = () => new FakeRpcError(-32000, "out of gas");

/** web3_clientVersion of the Hardhat node the shapes below were measured on. */
export const HARDHAT_VERSION = "HardhatNetwork/2.22.9/@nomicfoundation/edr/0.3.5";

/**
 * An eth_call error exactly as Hardhat 2.22.9 sends it: -32603 for every revert, the revert bytes
 * nested in `data.data` (absent from its own failures, e.g. "task 486 panicked").
 */
export const hardhatError = (message: string, data?: Hex) =>
  new FakeRpcError(-32603, `Error: ${message}`, {
    message: `Error: ${message}`,
    ...(data === undefined ? {} : { data }),
  });

export const errorData = (reason: string) =>
  encodeErrorResult({ abi: errorAbi, errorName: "Error", args: [reason] });

export const panicData = (code: bigint) =>
  encodeErrorResult({ abi: errorAbi, errorName: "Panic", args: [code] });

export type ContractsOptions = {
  abis: readonly Abi[];
  /** Answers one decoded eth_call. Return undefined for a function without outputs. */
  call: (call: ContractCall) => ContractAnswer | Promise<ContractAnswer>;
  /** Code at an address; defaults to some bytecode everywhere. Return "0x" for no contract. */
  code?: (address: Address, block: string) => Hex;
};

/** A FakeOptions.handle answering eth_call and eth_getCode from `options`. */
export function contracts(options: ContractsOptions) {
  return async (call: FakeCall): Promise<unknown> => {
    if (call.method === "eth_getCode") {
      const [address, block] = call.params as [Address, string];
      return options.code?.(address, block) ?? "0x6080604052";
    }
    if (call.method !== "eth_call") return new FakeRpcError(-32601, "method not found");
    const [tx, block, stateOverride] = call.params as [
      { to: Address; data: Hex; from?: Address; value?: Hex },
      string,
      ContractCall["stateOverride"],
    ];
    for (const abi of options.abis) {
      let decoded: { functionName: string; args?: readonly unknown[] };
      try {
        decoded = decodeFunctionData({ abi, data: tx.data }) as typeof decoded;
      } catch {
        continue;
      }
      const answer = await options.call({
        to: tx.to,
        from: tx.from,
        value: tx.value === undefined ? undefined : hexToBigInt(tx.value),
        block,
        stateOverride,
        functionName: decoded.functionName,
        args: decoded.args ?? [],
      });
      if (answer instanceof FakeRpcError) return answer;
      if (answer instanceof RawResult) return answer.data;
      if (answer === undefined) return "0x";
      return encodeFunctionResult({
        abi,
        functionName: decoded.functionName,
        result: answer,
      } as never);
    }
    return new FakeRpcError(3, "execution reverted");
  };
}

/** The l1-call lane over a fake upstream, failing fast (no retries) so upstream errors surface. */
export function fakeCallLane(
  handle: FakeOptions["handle"],
  options: Omit<FakeOptions, "handle"> = {}
) {
  const upstream = fakeJsonRpc({ ...options, handle });
  const lane: Lane = createLane({
    url: SECRET_URL,
    label: "l1-call",
    maxBatch: 20,
    maxInFlight: 8,
    fetch: upstream.fetch as typeof fetch,
    retries: 0,
    rateLimitRetries: 0,
    backoffMs: 1,
    timeoutMs: 200,
  });
  /** Every eth_call the app sent, decoded params. */
  const calls = () =>
    upstream.posts.flatMap((post) => post.calls.filter((c) => c.method === "eth_call"));
  return { lane, upstream, calls };
}
