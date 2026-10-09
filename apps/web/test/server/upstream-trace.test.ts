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

  it("copies only the named block tags (latest, finalized, safe, pending, earliest); any other text is 'other'", () => {
    for (const tag of ["latest", "finalized", "safe", "pending", "earliest"])
      expect(describeCall({ method: "eth_getBlockByNumber", params: [tag, false] })).toEqual({
        m: "eth_getBlockByNumber",
        tag,
      });
    const secret = "blk-private-request-text";
    const call = describeCall({ method: "eth_call", params: [{ to: SAFE, data: "0x" }, secret] });
    expect(call).toEqual({ m: "eth_call", sel: "none", tag: "other" });
    expect(JSON.stringify(call)).not.toContain("blk-");
    expect(
      describeCall({ method: "eth_getLogs", params: [{ fromBlock: secret, toBlock: "latest" }] })
    ).toEqual({ m: "eth_getLogs", tag: "other..latest" });
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

  /** Loads the preload over `upstream`; the result dumps a window and returns the file's text. */
  async function preload(upstream: (input: unknown, init?: RequestInit) => Promise<Response>) {
    globalThis.fetch = vi.fn(upstream) as typeof fetch;
    const out = join(dir, "trace");
    process.env.UPSTREAM_TRACE_OUT = out;
    vi.resetModules();
    await import("../support/upstream-trace.mjs");
    let n = 0;
    return () => {
      process.emit("SIGUSR2", "SIGUSR2");
      return readFileSync(`${out}.${n++}.json`, "utf8");
    };
  }
  const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

  it("records methods, answers' chain ids, heads and error codes, never a URL, host or key", async () => {
    // The answers a node gives: chain 1, head 0x10, and a revert for the eth_call.
    const dump = await preload(async (_input, init) => {
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
    });
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
    await tick();

    const text = dump();
    for (const secret of [key, "rpc.example", "safe.global", "://", "Bearer", "ordering"])
      expect(text).not.toContain(secret);
    const trace = JSON.parse(text);
    expect(trace.chains).toEqual({ [hostId("rpc.example")]: 1 });
    const kinds = trace.events.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k: string) => k === "rpc")).toHaveLength(1);
    expect(kinds.filter((k: string) => k === "safe")).toHaveLength(1);
    expect(trace.events.find((e: { kind: string }) => e.kind === "rpc")).toMatchObject({
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
    const next = JSON.parse(dump());
    expect(next.events).toEqual([]);
    expect(next.chains).toEqual(trace.chains);
  });

  it("counts a request in the window it was sent in, and what came for it later in the window it came in", async () => {
    // Chain 1 at once; a batch answered after its window was dumped (HTTP 429: a head, and
    // -32005 for its other entry); a Safe request never answered.
    let release: (() => void) | null = null;
    const dump = await preload(async (input, init) => {
      if (String(input).includes("never")) return new Promise<Response>(() => {});
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string }[];
      if (calls[0]?.method === "eth_chainId")
        return new Response(JSON.stringify([{ jsonrpc: "2.0", id: calls[0].id, result: "0x1" }]));
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response(
        JSON.stringify([
          { jsonrpc: "2.0", id: 1, result: "0x10" },
          { jsonrpc: "2.0", id: 2, error: { code: -32005, message: "limit" } },
        ]),
        { status: 429 }
      );
    });
    await fetch("https://rpc.example/v3/k", {
      method: "POST",
      body: JSON.stringify([{ jsonrpc: "2.0", id: 9, method: "eth_chainId", params: [] }]),
    });
    const sent = fetch("https://rpc.example/v3/k", {
      method: "POST",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getLogs",
          params: [{ fromBlock: "0x1", toBlock: "0x2" }],
        },
      ]),
    });
    void fetch(`https://never.example/api/v1/safes/${SAFE}/messages/?ordering=-modified&limit=1`);
    await tick(10);
    const first = JSON.parse(dump());
    (release as (() => void) | null)?.();
    await sent;
    await tick();
    const nextText = dump();

    expect(first.events).toEqual([
      expect.objectContaining({ kind: "rpc", status: 200, calls: [{ m: "eth_chainId" }] }),
      expect.objectContaining({
        kind: "rpc",
        inFlight: true,
        calls: [{ m: "eth_blockNumber" }, { m: "eth_getLogs", span: 2 }],
      }),
      expect.objectContaining({ kind: "safe", what: "check", inFlight: true }),
    ]);
    expect(first.events[1]).not.toHaveProperty("status");
    // The answer's status and its entries' error codes, never the request again, and its head.
    const next = JSON.parse(nextText);
    expect(next.events.map((e: { kind: string }) => e.kind)).toEqual(["answer", "head", "answer"]);
    expect(next.events[0]).toMatchObject({ of: "rpc", status: 429 });
    expect(next.events[0]).not.toHaveProperty("calls");
    expect(next.events[2]).toMatchObject({ of: "rpc", errors: { "-32005": 1 } });
    expect(nextText).not.toContain("rpc.example");
    // Counted with that window's errors, never as a request of it.
    const window = summarizeTrace(next, 60_000);
    expect(window.l1).toMatchObject({
      requests: 0,
      httpErrors: { "429": 1 },
      errors: { "-32005": 1 },
    });
    expect(window.inFlight).toBe(0);
  });

  it("builds answer records without the request's content, and marks what was not answered when a window is dumped", () => {
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
    const answered = { kind: "rpc", at: 1, ms: 40, host: "h", calls: [], status: 200 };
    const pending = { kind: "safe", at: 2, what: "check", safe: SAFE };
    const head = { kind: "head", at: 3, host: "h", number: 16 };
    const late = answerRecord(request, {}, 9);
    expect(dumped([answered, pending, head, late])).toEqual([
      answered,
      { ...pending, inFlight: true },
      head,
      late,
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
