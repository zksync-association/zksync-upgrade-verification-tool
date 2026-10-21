import {
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
  BaseError,
  RawContractError,
  RpcRequestError,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  isHex,
  numberToHex,
} from "viem";
import { FOREVER, cachedUntil, seed } from "../cache";
import { lanes, network, safeBlockNumber } from "../rpc";
import { LaneError, RpcError } from "./jsonrpc";

// Direct eth_call over the l1-call lane, and the one place that decides what a failed call means.
// A negative verdict (a signature "invalid", a threshold "rejected", a historical check "accepted:
// false", a simulation "reverted", the end of a member list) needs a DEFINITE revert: code 3, or
// -32000 "execution reverted" without out-of-gas text. Anything else fails the read instead. Never
// through Multicall3: a failed sub-call has no error code, and out of gas looks like a revert.

/** The contract reverted: a definite answer from the node, not a failure to get one. */
export class CallReverted extends Error {
  override name = "CallReverted";
  constructor(
    readonly reason: string,
    readonly data: Hex,
    readonly code: number
  ) {
    super(reason);
  }
}

/** The call got no definite answer: transport, rate limit, internal error, out of gas, ... */
export class UpstreamError extends Error {
  override name = "UpstreamError";
  readonly code: number | undefined;
  constructor(message: string, options: { code?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = options.code;
  }
}

/** The call succeeded but returned nothing usable for a function with outputs. Not an answer. */
export class UndecodableResult extends UpstreamError {
  override name = "UndecodableResult";
}

/** No contract at the address (at that block). A call to it "succeeds" without running code. */
export class NoContract extends Error {
  override name = "NoContract";
}

type RpcErrorShape = { code: number; message: string; data?: unknown };

const REVERTED = /execution reverted|reverted/i;
const OUT_OF_GAS = /out of gas|gas required exceeds|gas limit/i;
const HARDHAT_REVERTED = /\breverted\b/i;
const GANACHE_REVERT = /VM Exception while processing transaction: revert\b/i;

/**
 * How the node reports a revert. "standard": mainnet providers, anvil, Era. "hardhat" sends every
 * eth_call revert as -32603 with the revert bytes in `data.data` and "reverted" in its message (its
 * own failures never say "reverted" and carry no bytes). "ganache" sends -32000 "VM Exception
 * while processing transaction: revert[ reason]" with the revert bytes as `data`.
 */
type RevertDialect = "standard" | "hardhat" | "ganache";

/** A dev node that names itself in web3_clientVersion gets its dialect; every other node "standard". */
export function revertDialect(net: { isDevNode: boolean; clientVersion?: string }): RevertDialect {
  if (!net.isDevNode) return "standard";
  if (/HardhatNetwork/i.test(net.clientVersion ?? "")) return "hardhat";
  if (/ganache/i.test(net.clientVersion ?? "")) return "ganache";
  return "standard";
}

/**
 * A definite revert: code 3 (whatever its message says), or -32000 "execution reverted" without
 * out-of-gas text; on a dev node also its dialect's revert (with revert bytes, no out-of-gas text).
 */
function isDefiniteRevert(
  { code, message, data }: RpcErrorShape,
  dialect: RevertDialect = "standard"
): boolean {
  if (code === 3) return true;
  if (OUT_OF_GAS.test(message)) return false;
  if (code === -32000 && REVERTED.test(message)) return true;
  if (revertDataOf(data) === null) return false;
  if (dialect === "hardhat") return code === -32603 && HARDHAT_REVERTED.test(message);
  if (dialect === "ganache") return code === -32000 && GANACHE_REVERT.test(message);
  return false;
}

/**
 * What a failed call means: "revert" only for a definite revert, else "upstream" (no answer).
 * Walks viem errors for the node's JSON-RPC error; a failed Multicall3 sub-call is never definite.
 */
export function classify(
  error: unknown,
  dialect: RevertDialect = "standard"
): "revert" | "upstream" {
  if (error instanceof CallReverted) return "revert";
  const shape = rpcErrorShape(error);
  return shape !== null && isDefiniteRevert(shape, dialect) ? "revert" : "upstream";
}

function rpcErrorShape(error: unknown): RpcErrorShape | null {
  if (error instanceof RpcError)
    return { code: error.code, message: error.message, data: error.data };
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof RawContractError)) return null;
    const request = error.walk((e) => e instanceof RpcRequestError);
    return request instanceof RpcRequestError
      ? { code: request.code, message: request.details }
      : null;
  }
  // LaneError, UpstreamError, NoContract, network errors: no answer from the contract.
  if (error instanceof Error) return null;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, data } = error as Record<string, unknown>;
  return typeof code === "number"
    ? { code, message: typeof message === "string" ? message : "", data }
    : null;
}

export type CallRequest = {
  to: Address;
  data: Hex;
  from?: Address;
  value?: bigint;
  blockNumber?: bigint;
  stateOverride?: readonly { address: Address; balance: bigint }[];
};

const blockTag = (blockNumber?: bigint) =>
  blockNumber === undefined ? "latest" : numberToHex(blockNumber);

/** eth_call on the l1-call lane: CallReverted only for a definite revert, else UpstreamError. */
export async function ethCall(request: CallRequest, abi?: Abi): Promise<Hex> {
  const tx: Record<string, Hex> = { to: request.to, data: request.data };
  if (request.from) tx.from = request.from;
  if (request.value !== undefined) tx.value = numberToHex(request.value);
  const params: unknown[] = [tx, blockTag(request.blockNumber)];
  if (request.stateOverride?.length) {
    params.push(
      Object.fromEntries(
        request.stateOverride.map(({ address, balance }) => [
          address,
          { balance: numberToHex(balance) },
        ])
      )
    );
  }
  let result: unknown;
  try {
    result = await lanes().call.request("eth_call", params);
  } catch (error) {
    throw callError(error, abi, await dialectFor(error));
  }
  if (typeof result !== "string" || !isHex(result))
    throw new UpstreamError(`eth_call to ${request.to} returned no hex data`);
  return result;
}

/** The dialect, asked only when the standard rule finds no revert; "standard" if unknown. */
async function dialectFor(error: unknown): Promise<RevertDialect> {
  if (!(error instanceof RpcError) || isDefiniteRevert(error)) return "standard";
  try {
    return revertDialect(await network());
  } catch {
    return "standard";
  }
}

function callError(error: unknown, abi?: Abi, dialect: RevertDialect = "standard"): Error {
  if (error instanceof RpcError) {
    if (isDefiniteRevert(error, dialect)) {
      const data = revertDataOf(error.data) ?? "0x";
      return new CallReverted(reasonOf(abi, data, error.message), data, error.code);
    }
    return new UpstreamError(`${error.message} (JSON-RPC error ${error.code})`, {
      code: error.code,
      cause: error,
    });
  }
  // Lane errors are already scrubbed of the URL.
  if (error instanceof LaneError) return new UpstreamError(error.message, { cause: error });
  return new UpstreamError(error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function revertDataOf(data: unknown): Hex | null {
  if (typeof data === "string" && isHex(data)) return data;
  if (typeof data === "object" && data !== null) {
    const nested = (data as Record<string, unknown>).data;
    if (typeof nested === "string" && isHex(nested)) return nested;
  }
  return null;
}

function reasonOf(abi: Abi | undefined, data: Hex, message: string): string {
  if (data.length >= 10) {
    try {
      const { errorName, args } = decodeErrorResult({ abi: abi ?? [], data });
      if (errorName === "Error") return String(args?.[0] ?? "");
      if (errorName === "Panic") return `Panic(${numberToHex(args?.[0] as bigint)})`;
      return errorName;
    } catch {
      // An unknown custom error: the node's message names what it can.
    }
  }
  return message || "execution reverted";
}

type FunctionCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
  /** The hash of `blockNumber` when the read stands for that one block: presence is kept by it. */
  blockHash?: Hex;
};

/**
 * A contract function called directly (never through Multicall3) and decoded. Empty or undecodable
 * data rejects with UndecodableResult. A function without outputs succeeds only where there is
 * code: a call to an empty address also "succeeds" (NoContract).
 */
export async function callFn<T = unknown>(call: FunctionCall): Promise<T> {
  const { address, abi, functionName, args = [], blockNumber, blockHash } = call;
  const item = getAbiItem({ abi, name: functionName, args } as never) as AbiFunction | undefined;
  if (item?.type !== "function") throw new Error(`No function ${functionName} in the ABI`);
  const data = encodeFunctionData({ abi: [item], functionName, args } as never);
  if (item.outputs.length === 0) {
    await Promise.all([
      ethCall({ to: address, data, blockNumber }, abi),
      requireCode(address, blockNumber, blockHash),
    ]);
    return undefined as T;
  }
  const result = await ethCall({ to: address, data, blockNumber }, abi);
  if (result === "0x")
    throw new UndecodableResult(`${functionName}() on ${address} returned no data`);
  try {
    return decodeFunctionResult({ abi: [item], functionName, data: result } as never) as T;
  } catch (cause) {
    const message = `${functionName}() on ${address} returned data that does not decode`;
    throw new UndecodableResult(message, { cause });
  }
}

// A load-balanced RPC can name a head one of its backends does not have yet; that backend then
// says it does not know the block.
const UNKNOWN_BLOCK = /header not found|unknown block|block not found|cannot find block/i;

/** The node does not know the block (in the cause chain): never an answer about the contract. */
export function isUnknownBlock(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const { details, message, cause } = current as {
      details?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    for (const text of [details, message])
      if (typeof text === "string" && UNKNOWN_BLOCK.test(text.slice(0, 2_000))) return true;
    current = cause;
  }
  return false;
}

/** At or below the finality boundary (never on dev nodes); false when it cannot be read. */
export async function isFinalBlock(blockNumber: bigint): Promise<boolean> {
  try {
    const [net, safe] = await Promise.all([network(), safeBlockNumber()]);
    return !net.isDevNode && blockNumber <= safe;
  } catch {
    return false;
  }
}

const CODE_AT_HEAD_TTL_MS = 60_000;

/** Records code at `address` in block `blockHash`, as another read there showed (never absence). */
export function noteCodePresent(address: Address, blockHash: Hex) {
  seed(`code:${address.toLowerCase()}:h:${blockHash.toLowerCase()}`, true, CODE_AT_HEAD_TTL_MS);
}

/**
 * Rejects with NoContract when `address` has no code at `blockNumber` ('latest' when omitted).
 * Presence is kept a minute, for good at a final block, by `blockHash` when given; absence never.
 */
export async function requireCode(
  address: Address,
  blockNumber?: bigint,
  blockHash?: Hex
): Promise<void> {
  const at =
    blockNumber === undefined
      ? "latest"
      : blockHash === undefined
        ? blockNumber.toString()
        : `h:${blockHash.toLowerCase()}`;
  const present = await cachedUntil(`code:${address.toLowerCase()}:${at}`, async () => {
    // The boundary is read before the code: a block at or below it was final when it was read.
    const final = blockNumber === undefined ? false : await isFinalBlock(blockNumber);
    const code = await lanes()
      .call.request<unknown>("eth_getCode", [address, blockTag(blockNumber)])
      .catch((error: unknown) => {
        // No eth_getCode error is an answer about the contract.
        const upstream = callError(error);
        throw upstream instanceof CallReverted
          ? new UpstreamError(upstream.message, { cause: error })
          : upstream;
      });
    if (typeof code !== "string" || !isHex(code))
      throw new UpstreamError(`eth_getCode for ${address} returned no hex data`);
    const value = code !== "0x" && code !== "0x0";
    return { value, ttlMs: value ? (final ? FOREVER : CODE_AT_HEAD_TTL_MS) : 0 };
  });
  if (!present) {
    throw new NoContract(
      `No contract at ${address}${blockNumber === undefined ? "" : ` at block ${blockNumber}`}`
    );
  }
}
