import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/.server/rpc", () => ({
  network: async () => ({ safeTxServiceUrl: "https://api.safe.global/tx-service/eth" }),
}));

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
let api: typeof import("@/.server/safe-api");
let fetchMock: ReturnType<typeof vi.fn>;
const limited = (headers: Record<string, string>, body = "Monthly quota exceeded") =>
  new Response(body, { status: 429, headers });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  api = await import("@/.server/safe-api");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
