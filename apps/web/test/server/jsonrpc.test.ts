import {
  type LaneOptions,
  LaneError,
  RpcError,
  createLane,
  scrubText,
  secretsOf,
} from "@/.server/chain/jsonrpc";
import { lanes, resetRpcClients, rpcGeneration } from "@/.server/rpc";
import { defaultLogger } from "@config/log.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeOptions, FakeRpcError, fakeJsonRpc, hang } from "../support/fake-jsonrpc";

const URL_ = "http://rpc.example/";

function lane(upstream: FakeOptions, options: Partial<LaneOptions> = {}) {
  const fake = fakeJsonRpc(upstream);
  const l = createLane({
    url: URL_,
    label: "test",
    maxBatch: 25,
    maxInFlight: 8,
    backoffMs: 1,
    fetch: fake.fetch as typeof fetch,
    ...options,
  });
  return { lane: l, fake };
}

const getLogs = (i: number) => [
  { fromBlock: `0x${i.toString(16)}`, toBlock: `0x${i.toString(16)}` },
];
const blockOf = (call: { params: unknown[] }) =>
  Number.parseInt((call.params[0] as { fromBlock: string }).fromBlock, 16);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("batching", () => {
  it("matches replies to requests when the provider reorders them", async () => {
    const { lane: l, fake } = lane({
      reverse: true,
      handle: (call) => (call.method === "eth_chainId" ? "0x1" : `0x${blockOf(call).toString(16)}`),
    });
    const results = await Promise.all([
      l.request("eth_chainId"),
      l.request("eth_getLogs", getLogs(7)),
      l.request("eth_getLogs", getLogs(9)),
    ]);
    expect(results).toEqual(["0x1", "0x7", "0x9"]);
    expect(fake.sizes()).toEqual([3]);
    expect(fake.posts[0]?.batch).toBe(true);
  });

  it("sends a lone request as a plain JSON-RPC object", async () => {
    const { lane: l, fake } = lane({});
    expect(await l.request("eth_blockNumber")).toBe("0x1");
    expect(fake.posts[0]?.batch).toBe(false);
  });

  it.each([
    [25, 5],
    [50, 3],
    [10, 12],
  ])("sends 120 requests in POSTs of at most %i, at most 8 in flight", async (maxBatch, posts) => {
    const { lane: l, fake } = lane(
      { delayMs: 20, handle: (call) => [blockOf(call)] },
      { maxBatch, maxInFlight: 8 }
    );
    const results = await Promise.all(
      Array.from({ length: 120 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results).toEqual(Array.from({ length: 120 }, (_, i) => [i]));
    expect(Math.max(...fake.sizes())).toBeLessThanOrEqual(maxBatch);
    expect(fake.sizes().reduce((a, b) => a + b)).toBe(120);
    expect(fake.posts).toHaveLength(posts);
    expect(fake.peak()).toBeLessThanOrEqual(8);
    expect(l.stats().peakInFlight).toBeLessThanOrEqual(8);
    if (posts > 8) expect(fake.peak()).toBe(8);
  });

  it("caps the batch size at 50", () => {
    const { lane: l } = lane({}, { maxBatch: 500 });
    expect(l.stats().maxBatch).toBe(50);
  });

  it("isolates a per-entry error, including Infura's range answers, without retrying", async () => {
    const { lane: l, fake } = lane({
      handle: (call) => {
        const block = blockOf(call);
        if (block === 2) return new FakeRpcError(-32602, "range 20000 exceeds limit of 10000");
        if (block === 3)
          return new FakeRpcError(-32005, "query returned more than 10000 results", {
            from: "0x1",
          });
        return [block];
      },
    });
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map((i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: [1] });
    expect(results[3]).toEqual({ status: "fulfilled", value: [4] });
    const second = (results[1] as PromiseRejectedResult).reason;
    expect(second).toBeInstanceOf(RpcError);
    expect(second).toMatchObject({ code: -32602, message: "range 20000 exceeds limit of 10000" });
    const third = (results[2] as PromiseRejectedResult).reason;
    expect(third).toBeInstanceOf(RpcError);
    expect(third).toMatchObject({ code: -32005, data: { from: "0x1" } });
    expect(fake.posts).toHaveLength(1);
    expect(l.stats().rateLimited).toBe(0);
  });
});

describe("adapting to the provider", () => {
  // Tenderly's public gateway answers a batch of 7 or more eth_getLogs with HTTP 429.
  const tenderly = (limit = 7): FakeOptions => ({
    intercept: (post) =>
      post.calls.filter((c) => c.method === "eth_getLogs").length >= limit
        ? Response.json({ code: -32005, message: "rate limit exceeded" }, { status: 429 })
        : undefined,
    handle: (call) => [blockOf(call)],
  });

  it("converges below a Tenderly-like batch limit by halving the batch size first", async () => {
    const { lane: l, fake } = lane(tenderly(), { maxBatch: 20, maxInFlight: 8 });
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results).toEqual(Array.from({ length: 60 }, (_, i) => [i]));
    const accepted = fake.posts.filter((p) => p.calls.length < 7);
    expect(accepted.reduce((n, p) => n + p.calls.length, 0)).toBe(60);
    expect(Math.max(...accepted.map((p) => p.calls.length))).toBeLessThanOrEqual(5);
    // Recovery may already have added one back after 10 clean POSTs.
    expect(l.stats().batch).toBeLessThan(7);
    expect(l.stats()).toMatchObject({ inFlightLimit: 8, errors: 0 });
    expect(l.stats().rateLimited).toBeGreaterThan(0);
  });

  it("settles just below the limit from the history lane's 25 per batch", async () => {
    const { lane: l, fake } = lane(tenderly(), { maxBatch: 25, maxInFlight: 8 });
    const results = await Promise.all(
      Array.from({ length: 400 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results).toEqual(Array.from({ length: 400 }, (_, i) => [i]));
    // 25 and 12 are rejected, 6 works; a recovery probe at 7 goes back to 6, not to 3.
    const rejected = fake.posts.filter((p) => p.calls.length >= 7).map((p) => p.calls.length);
    expect(new Set(rejected)).toEqual(new Set([25, 12, 7]));
    expect(l.stats()).toMatchObject({ batch: 6, inFlightLimit: 8, errors: 0 });
  });

  it("halves the in-flight limit once the batch size is down to one, then recovers", async () => {
    let limited = 3;
    const { lane: l } = lane(
      {
        intercept: () =>
          limited-- > 0
            ? Response.json(
                { jsonrpc: "2.0", id: null, error: { code: -32005, message: "rate limited" } },
                { status: 429 }
              )
            : undefined,
      },
      { maxBatch: 2, maxInFlight: 4 }
    );
    await Promise.all(Array.from({ length: 4 }, () => l.request("eth_blockNumber")));
    expect(l.stats()).toMatchObject({ batch: 1, inFlightLimit: 2 });

    // +1 per 10 clean POSTs: in-flight first, back to its maximum.
    for (let i = 0; i < 20; i++) await l.request("eth_blockNumber");
    expect(l.stats()).toMatchObject({ batch: 1, inFlightLimit: 4 });
    // The batch size that was just rejected is not tried again for a minute.
    for (let i = 0; i < 10; i++) await l.request("eth_blockNumber");
    expect(l.stats().batch).toBe(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    for (let i = 0; i < 10; i++) await l.request("eth_blockNumber");
    expect(l.stats().batch).toBe(2);
  });

  it("reads a refused short POST as a rate limit: halves once and can recover to the full batch", async () => {
    let refuse = false;
    const { lane: l, fake } = lane({
      intercept: (post) => {
        if (!refuse || post.calls.length >= 25) return undefined;
        refuse = false;
        return new Response("", { status: 429 });
      },
      handle: (call) => (call.method === "eth_getLogs" ? [blockOf(call)] : "0x1"),
    });
    // Batches of 25 work.
    await Promise.all(Array.from({ length: 50 }, (_, i) => l.request("eth_getLogs", getLogs(i))));
    expect(fake.sizes()).toEqual([25, 25]);

    // The next wave's short tail is refused once: for the rate, not for its size.
    refuse = true;
    const wave = await Promise.all(
      Array.from({ length: 28 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(wave).toEqual(Array.from({ length: 28 }, (_, i) => [i]));
    expect(fake.sizes().slice(2)).toEqual([25, 3, 3]);
    expect(l.stats()).toMatchObject({ batch: 12, inFlightLimit: 8, rateLimited: 1, errors: 0 });

    // A burst goes out in POSTs of 12, not one by one.
    const before = fake.posts.length;
    await Promise.all(Array.from({ length: 100 }, (_, i) => l.request("eth_getLogs", getLogs(i))));
    expect(fake.posts.length - before).toBe(9);

    // Nothing caps recovery below 25: +1 per 10 clean POSTs climbs all the way back.
    for (let i = 0; i < 130; i++) await l.request("eth_blockNumber");
    expect(l.stats().batch).toBe(25);
  });

  it("halves the batch, not the in-flight limit, when a lone request is rate limited", async () => {
    let first = true;
    const { lane: l } = lane({
      intercept: () => {
        if (!first) return undefined;
        first = false;
        return new Response("", { status: 429 });
      },
    });
    expect(await l.request("eth_blockNumber")).toBe("0x1");
    expect(l.stats()).toMatchObject({ batch: 12, inFlightLimit: 8, rateLimited: 1 });
  });

  it.each([
    "Too many requests for eth_getLogs, slow down",
    "Request rate exceeded. Blocked for 10 seconds",
    "daily request count exceeded, request rate limited",
  ])("backs off and retries on -32005 '%s'", async (message) => {
    const limited = new Set<unknown>();
    const { lane: l, fake } = lane({
      handle: (call) => {
        if (limited.has(call.id)) return [blockOf(call)];
        limited.add(call.id);
        return new FakeRpcError(-32005, message);
      },
    });
    const results = await Promise.all([1, 2].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(results).toEqual([[1], [2]]);
    expect(fake.posts).toHaveLength(2);
    expect(l.stats()).toMatchObject({ rateLimited: 1, errors: 0 });
  });

  it.each([
    ["an internal error", Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603 } })],
    ["a proxy's page", new Response("<html>gateway</html>", { status: 200 })],
  ])(
    "retries a batch answered with %s once batches have worked, and keeps batching",
    async (_, response) => {
      let answered = 0;
      const { lane: l, fake } = lane({
        intercept: (post) => (post.batch && answered++ === 1 ? response.clone() : undefined),
        handle: (call) => [blockOf(call)],
      });
      await Promise.all([1, 2].map((i) => l.request("eth_getLogs", getLogs(i))));
      const results = await Promise.all([3, 4].map((i) => l.request("eth_getLogs", getLogs(i))));
      expect(results).toEqual([[3], [4]]);
      expect(fake.posts.map((p) => p.calls.length)).toEqual([2, 2, 2]);
      expect(l.stats()).toMatchObject({ acceptsBatch: true, batch: 25, errors: 0 });
    }
  );

  it("sends the entries of a batch refused with HTTP 400 one by one, and keeps batching", async () => {
    let answered = 0;
    const { lane: l, fake } = lane({
      intercept: (post) =>
        post.batch && answered++ === 1
          ? Response.json({ jsonrpc: "2.0", id: null, error: { code: -32602 } }, { status: 400 })
          : undefined,
      handle: (call) => [blockOf(call)],
    });
    await Promise.all([1, 2].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(await Promise.all([3, 4].map((i) => l.request("eth_getLogs", getLogs(i))))).toEqual([
      [3],
      [4],
    ]);
    await Promise.all([5, 6].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(fake.posts.map((p) => p.batch)).toEqual([true, true, false, false, true]);
    expect(l.stats()).toMatchObject({ acceptsBatch: true, batch: 25 });
  });

  it("honours Retry-After", async () => {
    let first = true;
    const { lane: l, fake } = lane({
      intercept: () => {
        if (!first) return undefined;
        first = false;
        return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } });
      },
    });
    expect(await l.request("eth_blockNumber")).toBe("0x1");
    expect(fake.posts).toHaveLength(2);
    const [a, b] = fake.posts;
    expect((b?.startedAt ?? 0) - (a?.startedAt ?? 0)).toBeGreaterThanOrEqual(950);
  });

  it("fails a request that stays rate limited", async () => {
    const { lane: l, fake } = lane(
      { intercept: () => new Response("", { status: 429 }) },
      { rateLimitRetries: 2 }
    );
    await expect(l.request("eth_blockNumber")).rejects.toMatchObject({
      kind: "rate-limited",
      status: 429,
    });
    expect(fake.posts).toHaveLength(3);
  });

  it("splits a batch whose body is too large, and keeps batching", async () => {
    const { lane: l, fake } = lane(
      {
        intercept: (post) =>
          post.calls.length > 4
            ? new Response("request body too large: limit is 8388608 bytes\n", { status: 400 })
            : undefined,
        handle: (call) => [blockOf(call)],
      },
      { maxBatch: 16 }
    );
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results).toEqual(Array.from({ length: 16 }, (_, i) => [i]));
    expect(fake.sizes()).toEqual([16, 8, 8, 4, 4, 4, 4]);
    expect(l.stats()).toMatchObject({ acceptsBatch: true, batch: 16 });

    // Later requests are batched as before.
    await Promise.all([1, 2, 3].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(fake.posts.at(-1)).toMatchObject({ batch: true, calls: { length: 3 } });
  });

  it("fails a single request whose body is too large", async () => {
    const { lane: l } = lane({
      intercept: () => new Response("request body too large", { status: 413 }),
    });
    const error = await l
      .request("eth_call", [{ to: "0x00", data: "0x00" }, "latest"])
      .catch((e) => e);
    expect(error).toBeInstanceOf(LaneError);
    expect(error).toMatchObject({ kind: "http", status: 413 });
  });

  it.each([
    ["HTTP 200 -32600", 200, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "no" } }],
    ["HTTP 200 -32601", 200, { jsonrpc: "2.0", id: null, error: { code: -32601, message: "no" } }],
    ["HTTP 400 -32600", 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "no" } }],
    ["a non-array reply", 200, { jsonrpc: "2.0", id: 1, result: "0x1" }],
  ])("switches to single requests after %s to a batch", async (_, status, body) => {
    const { lane: l, fake } = lane({
      intercept: (post) => (post.batch ? Response.json(body, { status }) : undefined),
      handle: (call) => [blockOf(call)],
    });
    const results = await Promise.all([1, 2, 3].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(results).toEqual([[1], [2], [3]]);
    await Promise.all([4, 5].map((i) => l.request("eth_getLogs", getLogs(i))));
    expect(fake.posts.map((p) => p.batch)).toEqual([true, false, false, false, false, false]);
    expect(l.stats()).toMatchObject({ acceptsBatch: false, batch: 1 });
  });

  it("caps the batch at the size that worked after Era's -32014", async () => {
    const { lane: l, fake } = lane(
      {
        intercept: (post) =>
          post.calls.length > 4
            ? Response.json({
                jsonrpc: "2.0",
                error: { code: -32014, message: "too many RPC calls in batch request" },
                id: null,
              })
            : undefined,
        handle: (call) => [blockOf(call)],
      },
      { maxBatch: 20 }
    );
    await Promise.all([1, 2, 3].map((i) => l.request("eth_getLogs", getLogs(i))));
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => l.request("eth_getLogs", getLogs(i)))
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => [i]));
    expect(l.stats()).toMatchObject({ batchCap: 3, batch: 3, acceptsBatch: true });
    expect(
      fake
        .sizes()
        .slice(2)
        .every((n) => n <= 3)
    ).toBe(true);
  });

  it("halves the batch after -32014 when no batch size has worked yet", async () => {
    const { lane: l } = lane(
      {
        intercept: (post) =>
          post.calls.length > 4
            ? Response.json({
                jsonrpc: "2.0",
                error: { code: -32014, message: "too many" },
                id: null,
              })
            : undefined,
      },
      { maxBatch: 20 }
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () => l.request("eth_blockNumber"))
    );
    expect(results).toEqual(Array(20).fill("0x1"));
    // 20, 10 and 5 are refused; 2 works.
    expect(l.stats()).toMatchObject({ batchCap: 2, batch: 2, errors: 0 });
  });
});

describe("transient failures", () => {
  it("retries a timeout twice without shrinking the lane", async () => {
    const fake = fakeJsonRpc({});
    let attempts = 0;
    const l = createLane({
      url: URL_,
      label: "test",
      maxBatch: 25,
      maxInFlight: 8,
      timeoutMs: 30,
      backoffMs: 1,
      fetch: (async (input: unknown, init?: RequestInit) => {
        if (attempts++ < 2) await hang(init?.signal);
        return fake.fetch(input, init);
      }) as typeof fetch,
    });
    expect(await Promise.all([l.request("eth_chainId"), l.request("eth_blockNumber")])).toEqual([
      "0x1",
      "0x1",
    ]);
    expect(attempts).toBe(3);
    expect(l.stats()).toMatchObject({ batch: 25, inFlightLimit: 8, retries: 4, errors: 0 });
  });

  it("fails with a timeout after the retries", async () => {
    const l = createLane({
      url: URL_,
      label: "test",
      maxBatch: 25,
      maxInFlight: 8,
      timeoutMs: 20,
      backoffMs: 1,
      fetch: ((_: unknown, init?: RequestInit) => hang(init?.signal)) as unknown as typeof fetch,
    });
    await expect(l.request("eth_blockNumber")).rejects.toMatchObject({ kind: "timeout" });
    expect(l.stats().posts).toBe(3);
  });

  it("retries HTTP 5xx and a reply that leaves out an entry", async () => {
    let failures = 1;
    const { lane: l, fake } = lane({
      intercept: (post) => {
        if (failures-- > 0) return new Response("bad gateway", { status: 502 });
        if (post.calls.length === 2)
          return Response.json([{ jsonrpc: "2.0", id: post.calls[0]?.id, result: "0xa" }]);
        return undefined;
      },
    });
    expect(await Promise.all([l.request("eth_chainId"), l.request("eth_blockNumber")])).toEqual([
      "0xa",
      "0x1",
    ]);
    expect(fake.sizes()).toEqual([2, 2, 1]);
  });

  it.each([
    ["a null id", { jsonrpc: "2.0", id: null, result: "0x" }],
    ["no id", { result: "0x" }],
    ["another id", { jsonrpc: "2.0", id: 999_999_999, result: "0x" }],
  ])("never takes a result under %s as the answer to a lone request", async (_, body) => {
    const { lane: l, fake } = lane({ intercept: () => Response.json(body) });
    const error = await l
      .request("eth_call", [{ to: "0x00", data: "0x00" }, "latest"])
      .catch((e) => e);
    expect(error).toBeInstanceOf(LaneError);
    expect(error).toMatchObject({ kind: "bad-response" });
    expect(fake.posts).toHaveLength(3);
  });

  it("takes an error with a null id as the answer to a lone request", async () => {
    const { lane: l, fake } = lane({
      intercept: () =>
        Response.json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        }),
    });
    const error = await l.request("eth_blockNumber").catch((e) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: -32700 });
    expect(fake.posts).toHaveLength(1);
  });

  it.each([401, 403])(
    "fails a lone request refused with HTTP %s and a non-JSON-RPC body at once",
    async (status) => {
      const { lane: l, fake } = lane({
        intercept: () => Response.json({ error: "invalid project id" }, { status }),
      });
      const error = await l.request("eth_blockNumber").catch((e) => e);
      expect(error).toBeInstanceOf(LaneError);
      expect(error).toMatchObject({ kind: "http", status });
      expect(fake.posts).toHaveLength(1);
    }
  );

  it("aborts queued and in-flight requests on close", async () => {
    const l = createLane({
      url: URL_,
      label: "test",
      maxBatch: 1,
      maxInFlight: 1,
      fetch: ((_: unknown, init?: RequestInit) => hang(init?.signal)) as unknown as typeof fetch,
    });
    const first = l.request("eth_blockNumber");
    const second = l.request("eth_chainId");
    await new Promise((r) => setTimeout(r, 10));
    l.close();
    await expect(first).rejects.toMatchObject({ kind: "aborted" });
    await expect(second).rejects.toMatchObject({ kind: "aborted" });
    await expect(l.request("eth_chainId")).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("read-only and secret-free", () => {
  it.each([
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "personal_sign",
    "eth_sign",
    "eth_signTypedData_v4",
    "anvil_setBalance",
  ])("rejects %s without sending anything", async (method) => {
    const { lane: l, fake } = lane({});
    const error = await l.request(method as never, ["0x00"]).catch((e: LaneError) => e);
    expect(error).toBeInstanceOf(LaneError);
    expect(error).toMatchObject({ kind: "method-not-allowed" });
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.posts).toHaveLength(0);
  });

  it("keeps the host and key out of every error and log line", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const queryKey = "SUPERSECRETQUERYKEY";
    const host = "secret-host.example";
    const url = `https://user:hunter22@${host}/v3/${key}?apikey=${queryKey}`;
    const lines: string[] = [];
    for (const level of ["warn", "error", "info", "debug"] as const)
      vi.spyOn(defaultLogger, level).mockImplementation(((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      }) as never);

    const respond = (body: string, status: number, headers?: HeadersInit) =>
      new Response(body, { status, headers });
    const scenarios: ((input: unknown, init?: RequestInit) => Promise<Response>)[] = [
      // fetch's own error names the URL
      async () => {
        throw new TypeError(`fetch failed for ${url}`, { cause: new Error(`getaddrinfo ${host}`) });
      },
      // an error page that echoes the request URL
      async () => respond(`<h1>401</h1> ${url} /v3/${key}`, 401),
      async () => respond(`request body too large for ${host}`, 413),
      // a node message that echoes the key
      async (_, init) => {
        const { id } = JSON.parse(String(init?.body));
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: `invalid project id ${key} at ${url}`, data: url },
        });
      },
      async () => respond(`slow down ${host}`, 429),
      async (_, init) => {
        await hang(init?.signal);
        throw new Error("unreachable");
      },
    ];

    const errors: unknown[] = [];
    for (const fetch of scenarios) {
      const l = createLane({
        url,
        label: "l1-call",
        maxBatch: 2,
        maxInFlight: 2,
        timeoutMs: 20,
        backoffMs: 1,
        rateLimitRetries: 1,
        fetch: fetch as typeof globalThis.fetch,
      });
      // Two at once also exercises the batch paths.
      const settled = await Promise.allSettled([
        l.request("eth_blockNumber"),
        l.request("eth_chainId"),
      ]);
      for (const r of settled) if (r.status === "rejected") errors.push(r.reason);
    }
    expect(errors.length).toBeGreaterThanOrEqual(scenarios.length);
    const texts = [
      ...errors.flatMap((e) => [String(e), (e as Error).stack ?? "", JSON.stringify(e)]),
      ...lines,
    ].join("\n");
    for (const secret of [host, key, queryKey, "hunter22", "https://"])
      expect(texts).not.toContain(secret);
    expect(errors.some((e) => e instanceof RpcError && e.code === -32001)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  describe.each(["a lone request", "a batch"])(
    "in an HTTP error body cut short, for %s",
    (shape) => {
      it.each([
        ["key", 401],
        ["host", 403],
      ])("leaves no part of the %s", async (which, status) => {
        const key = "0123456789abcdef0123456789abcdef";
        const host = "secret-host.example";
        const secret = which === "key" ? key : host;
        // The secret straddles the 200-character cut.
        const body = `${"x".repeat(190)} ${secret} trailing`;
        const l = createLane({
          url: `https://${host}/v3/${key}`,
          label: "l1-call",
          maxBatch: 2,
          maxInFlight: 2,
          backoffMs: 1,
          fetch: (async () => new Response(body, { status })) as typeof fetch,
        });
        const settled = await Promise.allSettled(
          shape === "a batch"
            ? [l.request("eth_blockNumber"), l.request("eth_chainId")]
            : [l.request("eth_blockNumber")]
        );
        for (const result of settled) {
          const error = (result as PromiseRejectedResult).reason;
          expect(error).toMatchObject({ kind: "http", status });
          expect(error.message).toContain("[redac");
          for (let n = 4; n <= secret.length; n++)
            expect(error.message).not.toContain(secret.slice(0, n));
        }
      });
    }
  );

  it("scrubs short app ids in the path and short query values, in any case", async () => {
    const appId = "a1b2c3d4e5";
    const token = "q7z9";
    const l = createLane({
      url: `https://eth.rpc.example/v1/${appId}?token=${token}`,
      label: "l1-call",
      maxBatch: 2,
      maxInFlight: 2,
      fetch: (async (_: unknown, init?: RequestInit) => {
        const { id } = JSON.parse(String(init?.body));
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32001,
            message: `invalid app ${appId} (token ${token.toUpperCase()}) for /v1`,
            data: { app: appId, list: [`${appId}!`] },
          },
        });
      }) as typeof fetch,
    });
    const error = await l.request("eth_blockNumber").catch((e: RpcError) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      message: "invalid app [redacted] (token [redacted]) for /v1",
      data: { app: "[redacted]", list: ["[redacted]!"] },
    });
  });

  it("keeps revert data hex when a short credential happens to occur in it", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const fake = fakeJsonRpc({
      handle: (call) => {
        const data = (call.params[0] as { data: string }).data;
        return new FakeRpcError(3, "execution reverted", {
          revert: data === "0x01" ? "0x08c379a0abcd0000" : `0x00${key}00`,
        });
      },
    });
    const l = createLane({
      url: `https://u:abcd@rpc.example/v3/${key}`,
      label: "l1-call",
      maxBatch: 2,
      maxInFlight: 2,
      fetch: fake.fetch as typeof fetch,
    });
    const [short, long] = await Promise.all(
      ["0x01", "0x02"].map((data) =>
        l.request("eth_call", [{ to: "0x00", data }, "latest"]).catch((e) => e)
      )
    );
    expect(short).toMatchObject({ code: 3, data: { revert: "0x08c379a0abcd0000" } });
    // A key is still removed, even from hex.
    expect(long).toMatchObject({ code: 3, data: { revert: "0x00[redacted]00" } });
  });

  it("removes a whole URL on the configured host, not just the host part", () => {
    // Redacting the configured origin first would leave "/v3/other-key" behind.
    const text = scrubText(
      "logs disabled on http://127.0.0.1:9/v3/other-key-0123456789",
      secretsOf("http://127.0.0.1:9")
    );
    expect(text).toBe("logs disabled on [url]");
  });
});

describe("rpc lanes", () => {
  it("keeps one set of L1 lanes per settings generation and closes the old ones", async () => {
    const before = lanes();
    expect(lanes()).toBe(before);
    expect(before.history.stats()).toMatchObject({ maxBatch: 25, maxInFlight: 8 });
    expect(before.call.stats()).toMatchObject({ maxBatch: 20, maxInFlight: 8 });
    expect(before.head.stats()).toMatchObject({ maxBatch: 2, maxInFlight: 4 });
    const generation = rpcGeneration();

    resetRpcClients();
    expect(rpcGeneration()).toBe(generation + 1);
    const after = lanes();
    expect(after).not.toBe(before);
    await expect(before.call.request("eth_chainId")).rejects.toMatchObject({ kind: "aborted" });
    await expect(before.head.request("eth_chainId")).rejects.toMatchObject({ kind: "aborted" });
    await expect(after.history.request("eth_sendRawTransaction" as never)).rejects.toMatchObject({
      kind: "method-not-allowed",
    });
  });
});

// The L1 lanes share one provider. A backfill's eth_getLogs (history lane) must never hold up
// the reads a page waits on (call and head lanes): not in the app (separate queues and POST
// slots), and not at the provider (while the call or head lane is rate limited or out of POST
// slots, the history lane sends one POST at a time).
describe("L1 lanes on one provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRpcClients();
  });

  it("answers a page's eth_call at once while the history lane is saturated", async () => {
    resetRpcClients();
    const fake = fakeJsonRpc({
      delayMs: (post) => (post.calls.some((c) => c.method === "eth_getLogs") ? 2_000 : 5),
      handle: (call) => (call.method === "eth_getLogs" ? [] : "0x"),
    });
    vi.stubGlobal("fetch", fake.fetch);
    const { history, call } = lanes();
    const backfill = Array.from({ length: 400 }, (_, i) =>
      history.request("eth_getLogs", getLogs(i)).catch(() => null)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(history.stats()).toMatchObject({ inFlight: 8 });
    const started = Date.now();
    await call.request("eth_call", [{ to: `0x${"11".repeat(20)}`, data: "0x" }, "latest"]);
    expect(Date.now() - started).toBeLessThan(200);
    history.close();
    await Promise.all(backfill);
  });

  it("sends one history POST at a time while the call lane is rate limited, then all of them again", async () => {
    resetRpcClients();
    let limited = 0;
    const fake = fakeJsonRpc({
      delayMs: (post) => (post.calls.some((c) => c.method === "eth_getLogs") ? 40 : 0),
      intercept: (post) => {
        if (!post.calls.some((c) => c.method === "eth_call") || limited > 0) return undefined;
        limited++;
        return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "1" } });
      },
      handle: (call) => (call.method === "eth_getLogs" ? [] : "0x"),
    });
    vi.stubGlobal("fetch", fake.fetch);
    const { history, call } = lanes();
    // A page's read is rate limited: the call lane pauses for a second.
    const read = call.request("eth_call", [{ to: `0x${"11".repeat(20)}`, data: "0x" }, "latest"]);
    await vi.waitFor(() => expect(call.busy()).toBe(true));
    const pausedAt = Date.now();
    const backfill = Promise.all(
      Array.from({ length: 2_000 }, (_, i) => history.request("eth_getLogs", getLogs(i)))
    );
    await read;
    const calls = fake.posts.filter((p) => p.calls.some((c) => c.method === "eth_call"));
    const resumedAt = calls.at(-1)?.startedAt ?? 0;
    expect(resumedAt - pausedAt).toBeGreaterThanOrEqual(900);
    await backfill;
    const logs = fake.posts.filter((p) => p.calls.some((c) => c.method === "eth_getLogs"));
    const during = logs.filter((p) => p.startedAt < resumedAt - 50);
    const after = logs.filter((p) => p.startedAt > resumedAt + 10);
    // While the page's lane waited, the backfill kept going, one POST at a time...
    expect(during.length).toBeGreaterThan(5);
    expect(Math.max(...during.map((p) => p.concurrent))).toBe(1);
    // ...and went back to its 8 POSTs at once after.
    expect(Math.max(...after.map((p) => p.concurrent))).toBeGreaterThan(4);
  });
});
