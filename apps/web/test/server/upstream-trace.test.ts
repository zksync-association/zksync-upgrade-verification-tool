import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, parseAbi } from "viem";
import { summarizeTrace } from "../support/benchmark-sync";
import {
  answerRecord,
  describeCall,
  describeRequest,
  dumped,
  hostId,
  safeRequest,
} from "../support/upstream-trace.mjs";

// The benchmark's preload (test/support/upstream-trace.mjs): what it records of each upstream
// request, and that a trace never holds a URL, a host, a query string or a key.

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SAFE = "0x1111111111111111111111111111111111111111";
const aggregate3 = encodeFunctionData({
  abi: parseAbi(["function aggregate3((address,bool,bytes)[]) returns ((bool,bytes)[])"]),
  args: [
    [
      [SAFE, true, "0x"],
      [SAFE, true, "0x1234"],
      [SAFE, false, "0x"],
    ],
  ],
});

describe("describeCall", () => {
  it("keeps the method, block tag, selector or aggregate3 size, and log span", () => {
    expect(
      describeCall({
        method: "eth_call",
        params: [{ to: MULTICALL3, data: aggregate3 }, "0x18ee93a"],
      })
    ).toEqual({ m: "eth_call", mc: 3, tag: 26_143_034 });
    expect(
      describeCall({
        method: "eth_call",
        params: [{ to: SAFE, data: `0x5ae6bd37${"00".repeat(32)}` }, "latest"],
      })
    ).toEqual({ m: "eth_call", sel: "0x5ae6bd37", tag: "latest" });
    expect(
      describeCall({
        method: "eth_call",
        params: [{ to: SAFE, data: "0x" }, { blockHash: `0x${"ab".repeat(32)}` }],
      })
    ).toEqual({ m: "eth_call", sel: "none", tag: "hash" });
    expect(
      describeCall({ method: "eth_getLogs", params: [{ fromBlock: "0x10", toBlock: "0x6f" }] })
    ).toEqual({ m: "eth_getLogs", span: 96 });
    expect(
      describeCall({ method: "eth_getLogs", params: [{ blockHash: `0x${"cd".repeat(32)}` }] })
    ).toEqual({ m: "eth_getLogs", tag: "hash" });
    expect(describeCall({ method: "eth_getBlockByNumber", params: ["finalized", false] })).toEqual({
      m: "eth_getBlockByNumber",
      tag: "finalized",
    });
    expect(describeCall({ method: "eth_getCode", params: [SAFE, "0x10"] })).toEqual({
      m: "eth_getCode",
      tag: 16,
    });
    expect(describeCall({})).toEqual({ m: "?" });
  });
});

describe("safeRequest", () => {
  const url = (path: string) => new URL(`https://safe.example${path}`);
  it("tells a change check, a listing page, a message and a Safe's info apart", () => {
    expect(safeRequest(url(`/api/v1/safes/${SAFE}/messages/?ordering=-modified&limit=1`))).toEqual({
      what: "check",
      safe: SAFE,
    });
    expect(
      safeRequest(url(`/api/v1/safes/${SAFE}/messages/?limit=100&offset=0&ordering=-created`))
    ).toEqual({ what: "listing", safe: SAFE });
    expect(safeRequest(url(`/api/v1/messages/0x${"ab".repeat(32)}/`))).toEqual({
      what: "message",
      safe: null,
    });
    expect(safeRequest(url(`/api/v1/safes/${SAFE}/`))).toEqual({ what: "info", safe: SAFE });
    expect(safeRequest(url("/api/v1/about/"))).toEqual({ what: "other", safe: null });
  });
});

describe("describeRequest", () => {
  it("names JSON-RPC hosts by a short hash, and leaves local requests out", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const described = describeRequest("https://rpc.example/v3/abcdef0123456789", body);
    expect(described).toEqual({
      kind: "rpc",
      host: hostId("rpc.example"),
      calls: [{ m: "eth_chainId" }],
    });
    expect(JSON.stringify(described)).not.toContain("rpc.example");
    // ZKsync Era by its name (without keeping it).
    const era = describeRequest("https://mainnet.era.zksync.io/", body);
    expect(era).toMatchObject({ kind: "rpc", hint: "era" });
    expect(JSON.stringify(era)).not.toContain("zksync");
    expect(describeRequest("https://rpc.example/v3/x", body)).not.toHaveProperty("hint");
    expect(describeRequest("http://127.0.0.1:3105/api/status", undefined)).toBeNull();
    expect(describeRequest("https://cdn.example/x.js", undefined)).toEqual({ kind: "other" });
    expect(describeRequest(`https://self-hosted.example/api/v1/safes/${SAFE}/`, undefined)).toEqual(
      {
        kind: "safe",
        what: "info",
        safe: SAFE,
      }
    );
  });
});

describe("the preload", () => {
  const original = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "upstream-trace-"));
  });

  afterEach(() => {
    globalThis.fetch = original;
    process.removeAllListeners("SIGUSR2");
    // biome-ignore lint/performance/noDelete: the variable must be unset, not "undefined".
    delete process.env.UPSTREAM_TRACE_OUT;
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records methods, answers' chain ids, heads and error codes, never a URL, host or key", async () => {
    // The answers a node gives: chain 1, head 0x10, and a revert for the eth_call.
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body !== "string") return new Response("[]", { status: 200 });
      const calls = JSON.parse(init.body) as { id: number; method: string }[];
      return new Response(
        JSON.stringify(
          calls.map((c) =>
            c.method === "eth_chainId"
              ? { jsonrpc: "2.0", id: c.id, result: "0x1" }
              : c.method === "eth_getBlockByNumber"
                ? { jsonrpc: "2.0", id: c.id, result: { number: "0x10" } }
                : { jsonrpc: "2.0", id: c.id, error: { code: 3, message: "execution reverted" } }
          )
        ),
        { status: 200 }
      );
    }) as typeof fetch;
    const out = join(dir, "trace");
    process.env.UPSTREAM_TRACE_OUT = out;
    vi.resetModules();
    await import("../support/upstream-trace.mjs");

    const key = "abcdef0123456789";
    await fetch(`https://rpc.example/v3/${key}`, {
      method: "POST",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
        { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "eth_call",
          params: [{ to: SAFE, data: "0x194b1ee6" }, "latest"],
        },
      ]),
    });
    await fetch(
      `https://safe-transaction-mainnet.safe.global/api/v1/safes/${SAFE}/messages/?ordering=-modified&limit=1`,
      { headers: { authorization: `Bearer ${key}` } }
    );
    await fetch("http://127.0.0.1:3105/api/status");
    await new Promise((resolve) => setTimeout(resolve, 20));

    process.emit("SIGUSR2", "SIGUSR2");
    const text = readFileSync(`${out}.0.json`, "utf8");
    for (const secret of [key, "rpc.example", "safe.global", "://", "Bearer", "ordering"])
      expect(text).not.toContain(secret);
    const trace = JSON.parse(text);
    expect(trace.chains).toEqual({ [hostId("rpc.example")]: 1 });
    const kinds = trace.events.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k: string) => k === "rpc")).toHaveLength(1);
    expect(kinds.filter((k: string) => k === "safe")).toHaveLength(1);
    const rpc = trace.events.find((e: { kind: string }) => e.kind === "rpc");
    expect(rpc).toMatchObject({
      status: 200,
      errors: { "3": 1 },
      calls: [
        { m: "eth_chainId" },
        { m: "eth_getBlockByNumber", tag: "latest" },
        { m: "eth_call", sel: "0x194b1ee6", tag: "latest" },
      ],
    });
    expect(trace.events.find((e: { kind: string }) => e.kind === "head")).toMatchObject({
      number: 16,
    });
    expect(trace.events.find((e: { kind: string }) => e.kind === "safe")).toMatchObject({
      what: "check",
      safe: SAFE,
      status: 200,
    });

    // The next dump starts afresh, and keeps which chain each host is.
    process.emit("SIGUSR2", "SIGUSR2");
    const next = JSON.parse(readFileSync(`${out}.1.json`, "utf8"));
    expect(next.events).toEqual([]);
    expect(next.chains).toEqual(trace.chains);
  });

  it("records a request in the window it was sent in, answered after that window or never", async () => {
    // An upstream that answers only when told to, and one request it never answers.
    let answer: (() => void) | null = null;
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("never")) return new Promise<Response>(() => {});
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      const calls = JSON.parse(String(init?.body)) as { id: number }[];
      return new Response(
        JSON.stringify(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: "0x10" })))
      );
    }) as typeof fetch;
    const out = join(dir, "trace");
    process.env.UPSTREAM_TRACE_OUT = out;
    vi.resetModules();
    await import("../support/upstream-trace.mjs");

    const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }]);
    const slow = fetch("https://rpc.example/v3/k", { method: "POST", body });
    void fetch(`https://never.example/api/v1/safes/${SAFE}/messages/?ordering=-modified&limit=1`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The window both were sent in ends before either is answered.
    process.emit("SIGUSR2", "SIGUSR2");
    (answer as (() => void) | null)?.();
    await slow;
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.emit("SIGUSR2", "SIGUSR2");

    const first = JSON.parse(readFileSync(`${out}.0.json`, "utf8"));
    expect(first.events).toEqual([
      expect.objectContaining({ kind: "rpc", inFlight: true, calls: [{ m: "eth_blockNumber" }] }),
      expect.objectContaining({ kind: "safe", what: "check", inFlight: true }),
    ]);
    expect(first.events[0]).not.toHaveProperty("status");
    // The next window has the answer (its status, never the request again) and the head it named.
    const next = JSON.parse(readFileSync(`${out}.1.json`, "utf8"));
    expect(next.events.map((e: { kind: string }) => e.kind)).toEqual(["answer", "head"]);
    expect(next.events[0]).toMatchObject({ of: "rpc", status: 200 });
    expect(next.events[0]).not.toHaveProperty("calls");
  });

  it("records an answer that comes after its request's window was dumped in the window it came in", async () => {
    // An upstream that answers when told to: HTTP 429 with -32005 (rate limited), after the
    // window the request was sent in was dumped (the leading dump a cost window discards).
    let answer: (() => void) | null = null;
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body));
      const calls = (Array.isArray(parsed) ? parsed : [parsed]) as { id: number; method: string }[];
      if (calls.some((c) => c.method === "eth_chainId"))
        return new Response(JSON.stringify([{ jsonrpc: "2.0", id: calls[0]?.id, result: "0x1" }]));
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit" } }),
        { status: 429 }
      );
    }) as typeof fetch;
    const out = join(dir, "trace");
    process.env.UPSTREAM_TRACE_OUT = out;
    vi.resetModules();
    await import("../support/upstream-trace.mjs");

    // The chain the host serves, as the app asks it at its start.
    await fetch("https://rpc.example/v3/k", {
      method: "POST",
      body: JSON.stringify([{ jsonrpc: "2.0", id: 9, method: "eth_chainId", params: [] }]),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sent = fetch("https://rpc.example/v3/k", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.emit("SIGUSR2", "SIGUSR2");
    (answer as (() => void) | null)?.();
    await sent;
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.emit("SIGUSR2", "SIGUSR2");

    const first = JSON.parse(readFileSync(`${out}.0.json`, "utf8"));
    expect(first.events[1]).toMatchObject({ kind: "rpc", inFlight: true });
    const next = JSON.parse(readFileSync(`${out}.1.json`, "utf8"));
    // The answer, in the window it came in: its status and its entry's error code.
    expect(next.events).toEqual([
      expect.objectContaining({ kind: "answer", of: "rpc", status: 429 }),
      expect.objectContaining({ kind: "answer", of: "rpc", errors: { "-32005": 1 } }),
    ]);
    expect(JSON.stringify(next)).not.toContain("rpc.example");
    // Counted with that window's errors, never as a request of it.
    const window = summarizeTrace(next, 60_000);
    expect(window.l1).toMatchObject({
      requests: 0,
      httpErrors: { "429": 1 },
      errors: { "-32005": 1 },
    });
    expect(window.inFlight).toBe(0);
  });

  it("builds an answer record from its request, without anything of the request's content", () => {
    const request = { kind: "rpc", at: 5, host: "abc123", calls: [{ m: "eth_call" }] };
    expect(answerRecord(request, { status: 503, ms: 40 }, 9)).toEqual({
      kind: "answer",
      at: 9,
      of: "rpc",
      sentAt: 5,
      host: "abc123",
      status: 503,
      ms: 40,
    });
    expect(
      answerRecord({ kind: "safe", at: 1, what: "check" }, { failed: "TypeError" }, 2)
    ).toEqual({ kind: "answer", at: 2, of: "safe", sentAt: 1, failed: "TypeError" });
    // A window's answer records are never marked in flight.
    expect(dumped([answerRecord(request, {}, 9)])).toEqual([answerRecord(request, {}, 9)]);
  });

  it("marks what was not answered when a window is dumped", () => {
    const answered = { kind: "rpc", at: 1, ms: 40, host: "h", calls: [], status: 200 };
    const pending = { kind: "safe", at: 2, what: "check", safe: SAFE };
    const head = { kind: "head", at: 3, host: "h", number: 16 };
    expect(dumped([answered, pending, head])).toEqual([
      answered,
      { ...pending, inFlight: true },
      head,
    ]);
    // The recorded event itself is left as it is: its answer may still come.
    expect(pending).not.toHaveProperty("inFlight");
  });

  it("does nothing without UPSTREAM_TRACE_OUT", async () => {
    const fake = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    globalThis.fetch = fake;
    vi.resetModules();
    await import("../support/upstream-trace.mjs");
    expect(globalThis.fetch).toBe(fake);
    expect(process.listenerCount("SIGUSR2")).toBe(0);
  });
});
