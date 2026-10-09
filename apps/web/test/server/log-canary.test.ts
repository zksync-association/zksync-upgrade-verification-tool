import { clearCache } from "@/.server/cache";
import {
  HttpRequestError,
  InternalRpcError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  type PublicClient,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The log-history canary: a transient failure is retried (3 attempts, with backoff) before it
// reads as "error", and an "error" is kept 30 s, not ten minutes, so a rate-limit blip (e.g.
// during the boot backfill) cannot pin logHistory to "error". Answers keep the ten minutes.

const CANARY = {
  address: "0x0000000000000000000000000000000000000c0a",
  topic0: `0x${"ca".repeat(32)}`,
  blockNumber: 21_788_382n,
};

vi.mock("@/.server/rpc", async (original) => ({
  ...(await original<typeof import("@/.server/rpc")>()),
  network: async () => ({ chainId: 1, logCanary: CANARY }),
}));

const { checkLogHistory, isTransientRpcFailure } = await import("@/.server/logs");

const rpc = (code: number, message: string) =>
  new RpcRequestError({ body: {}, error: { code, message }, url: "http://rpc.invalid" });
const internal = () => new InternalRpcError(rpc(-32603, "internal error"));
const LOG = {
  address: CANARY.address,
  topics: [CANARY.topic0],
  data: "0x",
  blockNumber: "0x14c7b5e",
  blockHash: `0x${"00".repeat(32)}`,
  transactionHash: `0x${"11".repeat(32)}`,
  transactionIndex: "0x0",
  logIndex: "0x0",
  removed: false,
};

/** A client whose eth_getLogs answers from `answers` in turn (an Error is thrown). */
function client(...answers: (unknown[] | Error)[]) {
  const request = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { request } as unknown as PublicClient, request };
}

/** Runs the check while fake time passes (its retries wait between attempts). */
async function check(c: PublicClient) {
  const result = checkLogHistory(c);
  await vi.advanceTimersByTimeAsync(10_000);
  return result;
}

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkLogHistory", () => {
  it("retries a transient failure and answers ok, kept for ten minutes", async () => {
    const { client: c, request } = client(internal(), internal(), [LOG]);
    expect(await check(c)).toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(9 * 60_000);
    expect(await check(c)).toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("reads missing (an empty answer) at once, and keeps it ten minutes", async () => {
    const { client: c, request } = client([]);
    expect(await check(c)).toEqual({ status: "missing", blockNumber: "21788382" });
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(9 * 60_000);
    await check(c);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads error after 3 attempts, and keeps it only 30 s", async () => {
    const { client: c, request } = client(internal());
    const result = await check(c);
    expect(result).toMatchObject({ status: "error" });
    expect(request).toHaveBeenCalledTimes(3);
    // Within 30 s of the answer: the same error.
    vi.advanceTimersByTime(20_000);
    await check(c);
    expect(request).toHaveBeenCalledTimes(3);
    // After it: asked again, and a recovered RPC reads ok.
    vi.advanceTimersByTime(10_000);
    request.mockImplementation(async () => [LOG]);
    expect(await check(c)).toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("leaves a rate limit to the request's own backoff (1 + 3 tries), without retrying it again", async () => {
    const { client: c, request } = client(
      new HttpRequestError({ url: "http://rpc.invalid", status: 429 })
    );
    expect(await check(c)).toMatchObject({ status: "error" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("does not retry an answer about the request itself", async () => {
    const { client: c, request } = client(
      new InvalidParamsRpcError(rpc(-32602, "history before block 22000000 is pruned"))
    );
    expect(await check(c)).toMatchObject({
      status: "error",
      message: expect.stringContaining("pruned"),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("isTransientRpcFailure", () => {
  it.each([
    ["-32603 internal error", internal(), true],
    ["-32005 limit exceeded", new LimitExceededRpcError(rpc(-32005, "limit exceeded")), true],
    ["-32000 request timed out", rpc(-32000, "request timed out"), true],
    ["-32000 header not found", rpc(-32000, "header not found"), false],
    ["-32602 invalid params", new InvalidParamsRpcError(rpc(-32602, "bad")), false],
    ["HTTP 429", new HttpRequestError({ url: "http://rpc.invalid", status: 429 }), true],
    ["HTTP 502", new HttpRequestError({ url: "http://rpc.invalid", status: 502 }), true],
    ["HTTP 401", new HttpRequestError({ url: "http://rpc.invalid", status: 401 }), false],
    ["a network failure", new HttpRequestError({ url: "http://rpc.invalid" }), true],
    ["a timeout", new TimeoutError({ body: {}, url: "http://rpc.invalid" }), true],
    ["a plain error", new TypeError("fetch failed"), true],
  ])("%s → %s", (_name, error, transient) => {
    expect(isTransientRpcFailure(error)).toBe(transient);
  });
});
