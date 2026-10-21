import { clearCache } from "@/.server/cache";
import type { Lane } from "@/.server/chain/jsonrpc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_URL, fakeCallLane } from "../support/fake-calls";
import { type FakeCall, FakeRpcError } from "../support/fake-jsonrpc";

// hasArchiveState: "no archive state" only when the node says so. A rate limit, a timeout, an
// internal error or the network failing is no answer: it rejects (the flows then show the check
// as not done, with the RPC error) and is not kept, so the next request asks again.

const state = vi.hoisted(() => ({
  lane: null as Lane | null,
  safe: 1_000n,
}));

vi.mock("@/.server/rpc", async (original) => ({
  ...(await original<typeof import("@/.server/rpc")>()),
  network: async () => ({ chainId: 1, isDevNode: false }),
  safeBlockNumber: async () => state.safe,
  lanes: () => ({ call: state.lane }),
}));

const { hasArchiveState } = await import("@/.server/flows/common");
const { UpstreamError } = await import("@/.server/chain/call");

const ADDRESS = "0x0000000000000000000000000000000000000abc";

let answer: (call: FakeCall) => unknown;
let balanceReads: () => number;

function upstream(options: Parameters<typeof fakeCallLane>[1] = {}) {
  const fake = fakeCallLane((call) => answer(call), options);
  state.lane = fake.lane;
  balanceReads = () =>
    fake.upstream.posts.flatMap((p) => p.calls).filter((c) => c.method === "eth_getBalance").length;
}

beforeEach(() => {
  clearCache();
  state.safe = 1_000n;
  answer = () => "0x0";
  upstream();
});

describe("hasArchiveState", () => {
  it("is true when the node answers at that block, and keeps it", async () => {
    expect(await hasArchiveState(ADDRESS, 900n)).toBe(true);
    expect(await hasArchiveState(ADDRESS, 900n)).toBe(true);
    expect(balanceReads()).toBe(1);
  });

  it.each([
    [-32000, "missing trie node 0x1234 (path ) state 0x5678 is not available"],
    [-32000, "historical state 0xabcd is not available"],
    [-32002, "No state available for block 0x384"],
    [-32000, "World state unavailable for block 900"],
    [-32000, "state at block #900 is pruned"],
    [-32001, "project ID does not have access to archive state"],
  ])("is false on %i %s, and keeps it", async (code, message) => {
    answer = () => new FakeRpcError(code, message);
    expect(await hasArchiveState(ADDRESS, 900n)).toBe(false);
    expect(await hasArchiveState(ADDRESS, 900n)).toBe(false);
    expect(balanceReads()).toBe(1);
  });

  it.each([
    ["-32603 internal error", () => new FakeRpcError(-32603, "internal error")],
    ["-32603 that mentions missing state", () => new FakeRpcError(-32603, "missing trie node")],
    ["-32005 limit exceeded", () => new FakeRpcError(-32005, "request rate exceeded; archive")],
    ["-32000 execution timeout", () => new FakeRpcError(-32000, "execution timeout")],
  ])("rejects on %s without keeping it", async (_name, error) => {
    answer = error;
    await expect(hasArchiveState(ADDRESS, 900n)).rejects.toBeInstanceOf(UpstreamError);
    answer = () => "0x0";
    expect(await hasArchiveState(ADDRESS, 900n)).toBe(true);
    expect(balanceReads()).toBe(2);
  });

  it("rejects on an HTTP 429 or 503, without the RPC URL in the error", async () => {
    for (const status of [429, 503]) {
      clearCache();
      upstream({ intercept: () => new Response("busy", { status }) });
      const error = await hasArchiveState(ADDRESS, 900n).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(String((error as Error).message)).not.toContain(new URL(SECRET_URL).hostname);
    }
  });

  it("rejects when the network fails", async () => {
    upstream({
      intercept: () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(hasArchiveState(ADDRESS, 900n)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("reads 'header not found' as no state only for a final block (a lagging backend says it too)", async () => {
    answer = () => new FakeRpcError(-32000, "header not found");
    // Above F: no answer.
    await expect(hasArchiveState(ADDRESS, 1_001n)).rejects.toBeInstanceOf(UpstreamError);
    // At or below F: the node does not keep that block.
    expect(await hasArchiveState(ADDRESS, 1_000n)).toBe(false);
  });
});
