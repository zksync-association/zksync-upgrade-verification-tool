import type { SafeMessage } from "@/.server/safe-api";
import { type Address, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET, SAFE_MESSAGES } from "../support/fixtures";

// Listing governance messages from the member Safes parses and hashes each message's typed data.
// On a page that work comes before the first bytes, so it is done once per message: the Safe store
// keeps the objects of messages that did not change when it reads a listing again, and the boot
// warm-up reads the listings held at the start (the last run's included). The real Safe store and
// client, in front of a fake (self-hosted) Safe Transaction Service holding mainnet's messages.

const state = vi.hoisted(() => ({
  lists: new Map<string, unknown[]>(),
  sent: 0,
  parsed: 0,
  // How far this test has moved the clock (ms).
  offset: 0,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    isDevNode: false,
    // Self-hosted: requests are not spaced.
    safeTxServiceUrl: "https://safe-tx.example.test",
  }),
}));

vi.mock("@/common/typed-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/common/typed-data")>();
  return {
    ...actual,
    parseGovernanceTypedData: (...args: Parameters<typeof actual.parseGovernanceTypedData>) => {
      state.parsed++;
      return actual.parseGovernanceTypedData(...args);
    },
  };
});

const { collectHeldMessages, collectMessages, warmMessageReadings } = await import(
  "@/.server/flows/messages"
);
const { heldSafeListing, holdLastRunListings } = await import("@/.server/safe/store");
const { clearCache } = await import("@/.server/cache");
const { resetSafeClient } = await import("@/.server/safe-api");

const SAFES = Object.keys(SAFE_MESSAGES).map((s) => getAddress(s));
const MESSAGES = Object.values(SAFE_MESSAGES).flat().length;
const board = {
  name: "EmergencyUpgradeBoard",
  version: "1",
  chainId: 1,
  verifyingContract: MAINNET.emergencyUpgradeBoard,
};
const EMERGENCY = [
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeZKFoundation",
] as const;

const realNow = Date.now.bind(Date);
const later = (ms: number) => {
  state.offset += ms;
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  state.offset = 0;
  state.sent = 0;
  state.parsed = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + state.offset);
  clearCache();
  resetSafeClient();
  state.lists = new Map(
    Object.entries(SAFE_MESSAGES).map(([safe, messages]) => [safe.toLowerCase(), copy(messages)])
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      state.sent++;
      const list = /\/api\/v1\/safes\/(0x[0-9a-fA-F]{40})\/messages\/$/.exec(url.pathname);
      if (!list) return new Response(null, { status: 404 });
      const all = state.lists.get((list[1] as string).toLowerCase()) ?? [];
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      // Parsed anew by the client, as a real answer is: new objects every time.
      return new Response(
        JSON.stringify({ count: all.length, results: all.slice(offset, offset + limit) }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("governance messages in member Safes' listings", () => {
  it("are parsed once: a listing read again unchanged keeps its objects, and a page's list from it parses nothing", async () => {
    const strict = await collectMessages(SAFES, EMERGENCY, board);
    expect(strict.errors).toEqual([]);
    expect(state.parsed).toBe(MESSAGES);
    const objects = SAFES.map((safe) => heldSafeListing(safe)?.messages);

    // A minute later every listing is read again (same content, new objects from Safe).
    later(61_000);
    const sent = state.sent;
    const again = await collectMessages(SAFES, EMERGENCY, board);
    expect(state.sent).toBeGreaterThanOrEqual(sent + SAFES.length);
    expect(again.groups).toEqual(strict.groups);
    for (const [i, safe] of SAFES.entries())
      expect(heldSafeListing(safe)?.messages).toBe(objects[i]);
    expect(state.parsed).toBe(MESSAGES);

    // A page's first answer from those listings, ten minutes on: nothing parsed either.
    later(10 * 60_000);
    const held = await collectHeldMessages(SAFES, EMERGENCY, board);
    expect(held).toMatchObject({ stale: true });
    expect(held?.groups).toEqual(strict.groups);
    expect(state.parsed).toBe(MESSAGES);
  });

  it("are parsed again only where a listing changed: a new message, or one Safe changed", async () => {
    await collectMessages(SAFES, EMERGENCY, board);
    const safe = SAFES[0] as Address;
    const before = heldSafeListing(safe)?.messages as SafeMessage[];
    const list = state.lists.get(safe.toLowerCase()) as SafeMessage[];
    expect(list.length).toBeGreaterThan(2);
    // A new owner confirmation on the newest message (Safe bumps its modified time).
    const changed = list[0] as SafeMessage;
    changed.confirmations = [...changed.confirmations, { ...changed.confirmations[0] }] as never;
    changed.modified = new Date(Date.now()).toISOString();

    later(61_000);
    state.parsed = 0;
    await collectMessages(SAFES, EMERGENCY, board);
    const after = heldSafeListing(safe)?.messages as SafeMessage[];
    expect(after).not.toBe(before);
    expect(after[0]).not.toBe(before[0]);
    // Every other message of that Safe keeps its object (and what was read from it).
    for (let i = 1; i < after.length; i++) expect(after[i]).toBe(before[i]);
    expect(state.parsed).toBe(1);
  });

  it("held at the start (the last run's) are parsed by the warm-up, so the first page parses nothing", async () => {
    const kept = Object.entries(SAFE_MESSAGES).map(([safe, messages]) => ({
      safe: getAddress(safe),
      messages: copy(messages) as unknown as SafeMessage[],
      complete: true,
      fetchedAt: Date.now() - 3_600_000,
    }));
    expect(holdLastRunListings(kept)).toBe(SAFES.length);
    expect(await warmMessageReadings(SAFES)).toBe(MESSAGES);
    expect(state.parsed).toBe(MESSAGES);
    // Read once: a second warm-up reads nothing.
    expect(await warmMessageReadings(SAFES)).toBe(0);

    const held = await collectHeldMessages(SAFES, EMERGENCY, board);
    expect(held).toMatchObject({ stale: true, errors: [] });
    expect(held?.groups.length).toBeGreaterThan(0);
    expect(state.parsed).toBe(MESSAGES);
    // Never a request to Safe.
    expect(state.sent).toBe(0);
  });
});
