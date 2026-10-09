import { limitedHttp } from "@/.server/rpc-transport";
import { defaultLogger } from "@config/log.server";
import { createPublicClient } from "viem";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["L1", "L2"])("names the %s source it was given in a slow-read warning", async (label) => {
  const warn = vi.spyOn(defaultLogger, "warn").mockImplementation((() => {}) as never);
  // Every POST takes 1.5 s on the clock the transport reads.
  let offset = 0;
  const now = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => now() + offset);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      offset += 1_500;
      const request = JSON.parse(init.body);
      const answer = (r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x1" });
      return Response.json(Array.isArray(request) ? request.map(answer) : answer(request));
    })
  );
  const client = createPublicClient({
    // The same in-flight cap for both: the label alone must name the source.
    transport: limitedHttp(`http://slow-${label}.example`, { label, maxInFlight: 8 }),
  });
  expect(await client.getChainId()).toBe(1);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ source: label, method: "eth_chainId", failed: false }),
    "Slow RPC read"
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain("example");
});

it("combines independent reads into one HTTP request and matches reordered response IDs", async () => {
  const fetch = vi.fn(async (_url, init) => {
    const requests = JSON.parse(init.body);
    return Response.json(
      requests
        .map((r: { id: number; method: string }) => ({
          jsonrpc: "2.0",
          id: r.id,
          result: r.method === "eth_chainId" ? "0x1" : "0xa",
        }))
        .reverse()
    );
  });
  vi.stubGlobal("fetch", fetch);
  const client = createPublicClient({
    transport: limitedHttp("http://batch.example", { label: "L1", maxInFlight: 8 }),
  });
  expect(await Promise.all([client.getChainId(), client.getBlockNumber()])).toEqual([1, 10n]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toHaveLength(2);
});

it.each([200, 400, 413])(
  "falls back for good when a provider rejects batches with HTTP %s",
  async (status) => {
    let batches = 0;
    let singles = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const request = JSON.parse(init.body);
        if (Array.isArray(request)) {
          batches++;
          return Response.json(
            { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch not supported" } },
            { status }
          );
        }
        singles++;
        return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x1" });
      })
    );
    const client = createPublicClient({
      transport: limitedHttp(`http://fallback-${status}.example`, { label: "L1", maxInFlight: 8 }),
    });
    expect(
      await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })])
    ).toEqual([1, 1n]);
    expect(await client.getChainId()).toBe(1);
    expect(batches).toBe(1);
    expect(singles).toBe(3);
  }
);

it("preserves individual RPC errors without retrying them through the fallback", async () => {
  const fetch = vi.fn(async (_url, init) =>
    Response.json(
      JSON.parse(init.body).map((r: { id: number }) => ({
        jsonrpc: "2.0",
        id: r.id,
        error: { code: -32602, message: "Invalid params" },
      }))
    )
  );
  vi.stubGlobal("fetch", fetch);
  const client = createPublicClient({
    transport: limitedHttp("http://errors.example", { label: "L1", maxInFlight: 8 }),
  });
  await expect(client.getChainId()).rejects.toThrow("Invalid params");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("splits bursts into bounded batches instead of sending one large payload", async () => {
  const sizes: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const requests = JSON.parse(init.body);
      sizes.push(requests.length);
      return Response.json(
        requests.map((r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x1" }))
      );
    })
  );
  const client = createPublicClient({
    transport: limitedHttp("http://bounded.example", { label: "L2", maxInFlight: 4 }),
  });
  expect(
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.getBalance({ address: `0x${i.toString(16).padStart(40, "0")}` })
      )
    )
  ).toEqual(Array(10).fill(1n));
  expect(sizes).toEqual([4, 4, 2]);
});

it.each([
  [400, "request body too large: limit is 8388608 bytes\n"],
  [413, "Payload Too Large"],
])(
  "retries an oversized batch (HTTP %s) as single requests and keeps batching",
  async (status, body) => {
    const sizes: number[] = [];
    let rejectNext = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const request = JSON.parse(init.body);
        if (!Array.isArray(request))
          return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x1" });
        sizes.push(request.length);
        if (rejectNext) {
          rejectNext = false;
          return new Response(body, { status });
        }
        return Response.json(
          request.map((r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x2" }))
        );
      })
    );
    const client = createPublicClient({
      transport: limitedHttp(`http://too-large-${status}.example`, { label: "L1", maxInFlight: 8 }),
    });
    // The rejected batch is answered by single requests...
    expect(
      await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })])
    ).toEqual([1, 1n]);
    // ...and the next reads are batched again.
    expect(
      await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })])
    ).toEqual([2, 2n]);
    expect(sizes).toEqual([2, 2]);
  }
);

it("keeps two batches of 8 in flight for a fan-out of 16 on L1", async () => {
  const sizes: number[] = [];
  let active = 0;
  let peak = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const requests = JSON.parse(init.body);
      sizes.push(requests.length);
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return Response.json(
        requests.map((r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x1" }))
      );
    })
  );
  const client = createPublicClient({
    transport: limitedHttp("http://fanout.example", { label: "L1", maxInFlight: 16, batchSize: 8 }),
  });
  await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      client.getBalance({ address: `0x${i.toString(16).padStart(40, "0")}` })
    )
  );
  expect(sizes).toEqual([8, 8]);
  expect(peak).toBe(2);
});
