import { getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ url: "https://api.safe.global/tx-service/eth" }));
vi.mock("@/.server/rpc", () => ({
  network: async () => ({ safeTxServiceUrl: service.url }),
}));

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const checksum = (address: string) => getAddress(address);
let api: typeof import("@/.server/safe-api");
let fetchMock: ReturnType<typeof vi.fn>;
const limited = (headers: Record<string, string>, body = "Monthly quota exceeded") =>
  new Response(body, { status: 429, headers });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  service.url = "https://api.safe.global/tx-service/eth";
  // Keyless unless a test says otherwise (an empty value also keeps dotenv from setting one).
  vi.stubEnv("SAFE_API_KEY", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  api = await import("@/.server/safe-api");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Re-imports the module with SAFE_API_KEY set (the pacer's spacing depends on it). */
async function withKey() {
  vi.stubEnv("SAFE_API_KEY", "test-key");
  vi.resetModules();
  api = await import("@/.server/safe-api");
}

const SAFE = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const emptyListing = () =>
  new Response(JSON.stringify({ count: 0, results: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * A Safe service answering every request after `latencyMs`, recording when each was sent and the
 * most requests it had in flight at once.
 */
function slowService(latencyMs: number) {
  const seen = { starts: [] as { at: number; path: string }[], inFlight: 0, peak: 0 };
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input);
    seen.starts.push({ at: Date.now(), path: `${url.pathname}${url.search}` });
    seen.inFlight++;
    seen.peak = Math.max(seen.peak, seen.inFlight);
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    seen.inFlight--;
    return emptyListing();
  });
  return seen;
}

const gaps = (starts: { at: number }[]) =>
  starts.slice(1).map((start, i) => start.at - (starts[i] as { at: number }).at);

describe("Safe request cooldown", () => {
  it("stops queued and subsequent requests until the monthly quota resets", async () => {
    fetchMock.mockResolvedValue(
      limited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3600" })
    );
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => api.getSafeMessage(hash(n))));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.quota.remaining).toBe(0);
    api.refreshSafeData();
    await expect(api.getSafeMessage(hash(5))).rejects.toThrow("monthly quota exhausted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_600_000);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(5))).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recognizes monthly exhaustion without quota headers and uses a bounded fallback", async () => {
    fetchMock.mockResolvedValue(limited({}));
    await expect(api.getSafeMessage(hash(1))).rejects.toThrow("monthly quota exhausted");
    vi.advanceTimersByTime(59_000);
    await expect(api.getSafeMessage(hash(2))).rejects.toThrow("monthly quota exhausted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(2))).resolves.toBeNull();
  });

  it("respects transient Retry-After without retrying during the page request", async () => {
    fetchMock.mockResolvedValue(
      limited({ "retry-after": "10", "x-ratelimit-remaining": "50" }, "Rate limited")
    );
    await expect(api.getSafeMessage(hash(1))).rejects.toThrow("temporarily rate limited");
    vi.advanceTimersByTime(9_000);
    await expect(api.getSafeMessage(hash(2))).rejects.toThrow("temporarily rate limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(2))).resolves.toBeNull();
  });

  it("accepts an HTTP-date Retry-After", async () => {
    fetchMock.mockResolvedValue(
      limited({ "retry-after": new Date(Date.now() + 5_000).toUTCString() }, "Rate limited")
    );
    await expect(api.getSafeMessage(hash(1))).rejects.toThrow("temporarily rate limited");
    vi.advanceTimersByTime(5_000);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(2))).resolves.toBeNull();
  });

  it("briefly remembers service failures without pretending a message is missing", async () => {
    fetchMock.mockRejectedValue(new Error("Connection failed"));
    await expect(api.getSafeMessage(hash(1))).rejects.toThrow("unreachable");
    await expect(api.getSafeMessage(hash(1))).rejects.toThrow("unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(1))).resolves.toBeNull();
  });

  it("discards a late quota response from the previous configuration", async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        })
    );
    const pending = api.getSafeMessage(hash(1));
    const result = expect(pending).rejects.toThrow("settings changed");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    api.resetSafeClient();
    respond(limited({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3600" }));
    await result;
    expect(api.quota.remaining).toBeNull();
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(api.getSafeMessage(hash(2))).resolves.toBeNull();
  });
});

describe("reads nobody asked for yet (warm-up, background refresh)", () => {
  it("are allowed with a key, or against a self-hosted service, never keyless on the public one", () => {
    const pub = "https://api.safe.global/tx-service/eth";
    expect(api.isPublicSafeService(pub)).toBe(true);
    expect(api.backgroundSafeReadsAllowed(pub, undefined)).toBe(false);
    expect(api.backgroundSafeReadsAllowed(pub, "")).toBe(false);
    expect(api.backgroundSafeReadsAllowed(pub, "key")).toBe(true);
    for (const own of ["http://127.0.0.1:18546", "https://safe-tx.example.org/api"]) {
      expect(api.isPublicSafeService(own)).toBe(false);
      expect(api.backgroundSafeReadsAllowed(own, undefined)).toBe(true);
    }
    // Only the public host itself: a look-alike name is someone else's service.
    expect(api.isPublicSafeService("https://api.safe.global.example.org/x")).toBe(false);
  });
});

describe("the request pacer", () => {
  it("starts requests at least 550 ms apart without a key", async () => {
    const seen = slowService(0);
    const reads = Promise.all([1, 2, 3, 4, 5, 6].map((n) => api.fetchListing(SAFE(n))));
    await vi.advanceTimersByTimeAsync(10_000);
    await reads;
    expect(seen.starts).toHaveLength(6);
    for (const gap of gaps(seen.starts)) expect(gap).toBeGreaterThanOrEqual(550);
  });

  it("starts requests at least 220 ms apart with a key, and never has more than 4 in flight", async () => {
    await withKey();
    // Slow answers: at 220 ms spacing, a 2 s answer would otherwise overlap with nine others.
    const seen = slowService(2_000);
    const reads = Promise.all(Array.from({ length: 12 }, (_, n) => api.fetchListing(SAFE(n + 1))));
    await vi.advanceTimersByTimeAsync(30_000);
    await reads;
    expect(seen.starts).toHaveLength(12);
    for (const gap of gaps(seen.starts)) expect(gap).toBeGreaterThanOrEqual(220);
    expect(seen.peak).toBe(4);
  });

  it("caps a self-hosted service at 4 in flight too, without spacing", async () => {
    service.url = "http://127.0.0.1:18546";
    const seen = slowService(1_000);
    const reads = Promise.all(Array.from({ length: 10 }, (_, n) => api.fetchListing(SAFE(n + 1))));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.starts).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5_000);
    await reads;
    expect(seen.starts).toHaveLength(10);
    expect(seen.peak).toBe(4);
    // Each wave starts as soon as the previous one answers.
    expect(seen.starts.map((s) => s.at - (seen.starts[0] as { at: number }).at)).toEqual([
      0, 0, 0, 0, 1_000, 1_000, 1_000, 1_000, 2_000, 2_000,
    ]);
  });

  it("starts a waiting request a page needs before waiting background requests", async () => {
    const seen = slowService(0);
    const low = () => ({ ticket: { priority: "low" as const } });
    const background = [1, 2, 3].map((n) => api.fetchListing(SAFE(n), low()));
    await vi.advanceTimersByTimeAsync(0);
    // The first background request went out at once; two wait for their slots.
    expect(seen.starts).toHaveLength(1);
    const page = api.fetchListing(SAFE(9));
    // A background request promoted while it waits goes ahead of the other one as well.
    const promoted = { ticket: { priority: "low" as "low" | "high" } };
    const joined = api.fetchListing(SAFE(8), promoted);
    promoted.ticket.priority = "high";
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([...background, page, joined]);
    const order = seen.starts.map((s) => /\/safes\/(0x[0-9a-fA-F]{40})\//.exec(s.path)?.[1]);
    expect(order).toEqual([SAFE(1), SAFE(9), SAFE(8), SAFE(2), SAFE(3)].map(checksum));
  });

  it("asks for the newest message by modification in one small request", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 25,
          results: [
            {
              created: "2026-08-15T00:06:58.176303Z",
              modified: "2026-08-16T10:00:00.000001Z",
              safe: checksum(SAFE(1)),
              messageHash: hash(7),
              message: "hello",
              confirmations: [],
            },
          ],
        }),
        { status: 200 }
      )
    );
    await expect(api.fetchNewest(SAFE(1))).resolves.toEqual({
      count: 25,
      messageHash: hash(7),
      modified: "2026-08-16T10:00:00.000001Z",
      arrivedAt: Date.now(),
    });
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("ordering")).toBe("-modified");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("drops a body that arrives after a settings change", async () => {
    let finish!: () => void;
    fetchMock.mockImplementationOnce(async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () =>
        new Promise((resolve) => {
          finish = () => resolve({ count: 0, results: [] });
        }),
    }));
    const pending = api.fetchListing(SAFE(1));
    const result = expect(pending).rejects.toThrow("settings changed");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    api.resetSafeClient();
    finish();
    await result;
  });

  it("counts requests sent before a settings change until they are answered: never more than 4 in flight", async () => {
    await withKey();
    const seen = slowService(5_000);
    const old = [1, 2, 3, 4].map((n) => api.fetchListing(SAFE(n)).catch((error: unknown) => error));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.inFlight).toBe(4);
    api.resetSafeClient();
    const fresh = Promise.all([5, 6, 7, 8].map((n) => api.fetchListing(SAFE(n))));
    await vi.advanceTimersByTimeAsync(1_000);
    // The old requests are still at the service: the new ones wait for their answers.
    expect(seen.starts).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(20_000);
    await fresh;
    expect(seen.starts).toHaveLength(8);
    expect(seen.peak).toBe(4);
    for (const error of await Promise.all(old)) expect(String(error)).toContain("settings changed");
  });

  it("fails requests still waiting for a slot when the settings change", async () => {
    slowService(0);
    const reads = [1, 2, 3].map((n) => api.fetchListing(SAFE(n)));
    const settled = Promise.allSettled(reads);
    await vi.advanceTimersByTimeAsync(0);
    api.resetSafeClient();
    const results = await settled;
    expect(results[0]?.status).toBe("fulfilled");
    for (const result of results.slice(1)) {
      expect(result.status).toBe("rejected");
      expect(String((result as PromiseRejectedResult).reason)).toContain("settings changed");
    }
  });
});
