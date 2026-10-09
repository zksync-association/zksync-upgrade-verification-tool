import { countUpstream, resetUpstreamCost, upstreamCost } from "@/.server/sync/cost";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rolling one-hour counts behind /api/status sync.engine.cost: what was sent upstream in the
// current minute and the 59 before it, per kind.

const NOW = Date.parse("2026-10-06T08:00:00Z");
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetUpstreamCost();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upstreamCost", () => {
  it("counts requests per kind for the last hour, and forgets them after it", () => {
    countUpstream("l1", 20);
    countUpstream("l1");
    countUpstream("l2", 3);
    countUpstream("safe");
    expect(upstreamCost()).toEqual({
      rpcPerHour: 24,
      l1RpcPerHour: 21,
      l2RpcPerHour: 3,
      safePerHour: 1,
      infuraCreditsPerHour: 0,
      creditsBasis: "estimate: Infura credit weights (eth_getLogs 255, eth_chainId 5, others 80)",
      windowMs: 0,
    });
    vi.setSystemTime(NOW + 30 * MIN);
    countUpstream("safe", 2);
    expect(upstreamCost()).toMatchObject({ rpcPerHour: 24, safePerHour: 3, windowMs: 30 * MIN });
    // The first minute's requests leave the window an hour later; the later ones stay.
    vi.setSystemTime(NOW + 60 * MIN);
    expect(upstreamCost()).toMatchObject({ rpcPerHour: 0, safePerHour: 2, windowMs: 60 * MIN });
    vi.setSystemTime(NOW + 90 * MIN);
    expect(upstreamCost()).toMatchObject({ rpcPerHour: 0, safePerHour: 0, windowMs: 60 * MIN });
  });

  it("keeps counting across hours in one-minute buckets (a slot is reused, never added to)", () => {
    for (let minute = 0; minute < 180; minute++) {
      vi.setSystemTime(NOW + minute * MIN);
      countUpstream("l1", 10);
    }
    expect(upstreamCost().l1RpcPerHour).toBe(600);
    // Nothing for half an hour.
    vi.setSystemTime(NOW + 209 * MIN);
    expect(upstreamCost().l1RpcPerHour).toBe(300);
  });

  it("ignores counts that are not positive", () => {
    countUpstream("l1", 0);
    countUpstream("l1", -5);
    countUpstream("l1", Number.NaN);
    expect(upstreamCost().rpcPerHour).toBe(0);
  });
});
