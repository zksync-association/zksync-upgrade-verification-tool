import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Where what a page shows is said to be read (components/verification/content-currency.tsx):
// - a list built on governance (the freeze requests, the pending emergency upgrades) is noted at
//   the block its governance was read at when that is older than the head, by the engine's content
//   pass and by "Check Safe now", as the status is: never named current at a head it was not read
//   at (its requests' states are governance's);
// - content that changed since the tab rendered it is named at the block it was last noted at, so
//   while its reload waits (a Sign dialog open, the reload gap) the page shows it as of that block,
//   with Sign and Send waiting, never as current under the newer head.

const engine = vi.hoisted(() => ({
  view: { head: null as unknown, catchingUp: false },
}));
vi.mock("@/.server/sync/engine", () => ({
  wakeSync: () => {},
  noteSigned: () => {},
  syncView: () => engine.view,
  listSafeChecks: () => ({}),
}));
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({
    status: () => ({
      state: "ready",
      chunks: { done: 1, total: 1 },
      deployBlock: "1",
      finalizedTo: "2",
      coveredFrom: "2",
    }),
  }),
}));

const MEMBERS = [
  "0x0000000000000000000000000000000000000a01",
  "0x0000000000000000000000000000000000000a02",
] as const;
const governance = (block: bigint) => ({
  latestBlock: { number: block.toString(), timestamp: "1790000000" },
  securityCouncil: { members: [...MEMBERS] },
  guardians: { members: [...MEMBERS] },
  emergencyUpgradeBoard: { zkFoundation: MEMBERS[0] },
});
const world = vi.hoisted(() => ({
  /** The block the lists' governance was read at. */
  governanceBlock: 0n,
  /** The head requests are served. */
  head: 0n,
}));
vi.mock("@/.server/flows/freeze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/flows/freeze")>()),
  heldFreezeList: async () => ({
    requests: [{ action: "SoftFreeze", nonce: "0", validUntil: "1", state: { status: "open" } }],
    errors: [],
    anomalies: 0,
    governance: governance(world.governanceBlock),
    safeFetchedAt: null,
    stale: false,
  }),
}));
vi.mock("@/.server/flows/emergency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/flows/emergency")>()),
  heldEmergencyList: async () => ({
    pending: { pending: [], errors: [], anomalies: 0, safeFetchedAt: null, stale: false },
    executed: [],
    governance: governance(world.governanceBlock),
  }),
}));
vi.mock("@/.server/page-governance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/page-governance")>()),
  pageGovernance: async () => governance(world.governanceBlock),
}));
vi.mock("@/.server/safe/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/safe/store")>()),
  checkSafesNow: async (safes: readonly string[]) => ({ checked: safes.length, failed: [] }),
}));
vi.mock("@/.server/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/rpc")>()),
  network: async () => ({ chainId: 1 }),
  latestBlock: async () => ({ number: world.head, hash: "0x01", timestamp: 1_790_000_000n }),
}));

const { noteOnScreenContent } = await import("@/.server/sync/content-engine");
const { noteContent, notedHead, resetRevs, touchRev } = await import("@/.server/sync/revs");
const { resetPresence } = await import("@/.server/sync/presence");
const { action: beatAction } = await import("@/routes/resources+/presence");
const { action: safeCheckAction } = await import("@/routes/resources+/safe-check");
const { contentCurrency } = await import("@/components/verification/content-currency");

const HEADERS = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

async function beat(items: { key: string; rev: string | null }[]) {
  const response = (await beatAction({
    request: new Request("http://localhost/resources/presence", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ tab: "tab-under-test", reason: "interval", items }),
    }),
    params: {},
    context: {},
  } as never)) as Response;
  return (await response.json()) as {
    changed: string[];
    unknown: string[];
    notedAt: Record<string, { rev: string; block: string }>;
    nextMs: number;
  };
}

const served = (n: bigint) => {
  world.head = n;
  engine.view = { head: { number: n, hash: "0x01", timestamp: 1_790_000_000n }, catchingUp: false };
};
const block = (n: bigint) => ({
  number: n,
  hash: "0x01" as const,
  parentHash: "0x00" as const,
  timestamp: 1_790_000_000n,
});

beforeEach(() => {
  resetRevs();
  resetPresence();
});
afterEach(() => {
  resetRevs();
  resetPresence();
});

describe("a list built on governance is noted at the block its governance was read at", () => {
  it("the engine's content pass: at that block when it is older than the head, else at the head", async () => {
    served(100n);
    // Governance kept from block 95 (a full read cached up to 30 s, or not read again at 100).
    world.governanceBlock = 95n;
    const keys = ["list:freeze", "list:emergency", "list:emergency:all"];
    expect(await noteOnScreenContent(block(100n), keys)).toEqual({ noted: 3, skipped: 0 });
    for (const key of keys) expect(notedHead(key)).toBe(95n);
    // Governance read at the head again: noted at it; never at a block newer than the head.
    world.governanceBlock = 101n;
    expect(await noteOnScreenContent(block(101n), keys)).toEqual({ noted: 3, skipped: 0 });
    for (const key of keys) expect(notedHead(key)).toBe(101n);
    world.governanceBlock = 103n;
    await noteOnScreenContent(block(102n), keys);
    for (const key of keys) expect(notedHead(key)).toBe(102n);
  });

  it("the beat then names the list behind the served head, and the page says so", async () => {
    served(100n);
    world.governanceBlock = 97n;
    await noteOnScreenContent(block(100n), ["list:freeze"]);
    // What a page's reload of the same list reports (the same content: the same revision).
    const page = await import("@/.server/flows/freeze").then(({ heldFreezeList }) =>
      heldFreezeList()
    );
    const { freezeListContent } = await import("@/.server/sync/content");
    const item = noteContent(
      "list:freeze",
      { head: 97n },
      freezeListContent(page as NonNullable<typeof page>)
    );
    const answer = await beat([item]);
    expect(answer.changed).toEqual([]);
    expect(answer.notedAt["list:freeze"]).toEqual({ rev: item.rev, block: "97" });
    expect(
      contentCurrency("list:freeze", { head: { number: "100" }, notedAt: answer.notedAt })
    ).toEqual({ block: "97", behind: "100" });
  });

  it('"Check Safe now" notes the list it read at that block too', async () => {
    served(200n);
    world.governanceBlock = 196n;
    // The council's Safes; for emergencies the guardians' and the foundation's too.
    for (const [key, safes] of [
      ["list:freeze", 2],
      ["list:emergency", 5],
    ] as const) {
      const response = (await safeCheckAction({
        request: new Request("http://localhost/resources/safe-check", {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ key }),
        }),
        params: {},
        context: {},
      } as never)) as Response;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ key, checked: safes, failed: 0 });
      expect(notedHead(key)).toBe(196n);
    }
    // Governance at the head: at the head.
    world.governanceBlock = 200n;
    resetRevs();
    await safeCheckAction({
      request: new Request("http://localhost/resources/safe-check", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ key: "list:freeze" }),
      }),
      params: {},
      context: {},
    } as never);
    expect(notedHead("list:freeze")).toBe(200n);
  });
});

describe("content that changed since the tab rendered it is named at the block it was last noted at", () => {
  const KEY = "upgrade:0x01";

  it("while its reload waits: behind the served head (Sign and Send wait), and soon beaten again", async () => {
    served(102n);
    const shown = noteContent(KEY, { head: 100n }, { state: 1 });
    // Read again at 101 with the same result; then its state changes at 102.
    expect(noteContent(KEY, { head: 101n }, { state: 1 }).rev).toBe(shown.rev);
    const now = noteContent(KEY, { head: 102n }, { state: 2 });
    expect(now.rev).not.toBe(shown.rev);
    // The tab still shows the state from before (its reload held while a Sign dialog is open).
    const answer = await beat([shown]);
    expect(answer.changed).toEqual([KEY]);
    expect(answer.notedAt[KEY]).toEqual({ rev: shown.rev, block: "101" });
    expect(contentCurrency(KEY, { head: { number: "102" }, notedAt: answer.notedAt })).toEqual({
      block: "101",
      behind: "102",
    });
    // The next beat comes soon, so once the reload lands its new content is named at once.
    expect(answer.nextMs).toBe(2_000);
    // The reload landed: the new content, current at the served head.
    const after = await beat([now]);
    expect(after.changed).toEqual([]);
    expect(after.notedAt[KEY]).toEqual({ rev: now.rev, block: "102" });
    expect(contentCurrency(KEY, { head: { number: "102" }, notedAt: after.notedAt })).toEqual({
      block: "102",
      behind: null,
    });
    expect(after.nextMs).toBe(10_000);
  });

  it("touched content, and several changes in a row, are named at the block of what the tab shows", async () => {
    served(110n);
    const first = noteContent(KEY, { head: 105n }, { state: 1 });
    const second = noteContent(KEY, { head: 107n }, { state: 2 });
    noteContent(KEY, { head: 108n }, { state: 2 });
    noteContent(KEY, { head: 109n }, { state: 3 });
    touchRev(KEY);
    const answer = await beat([first]);
    expect(answer.changed).toEqual([KEY]);
    expect(answer.notedAt[KEY]).toEqual({ rev: first.rev, block: "105" });
    expect((await beat([second])).notedAt[KEY]).toEqual({ rev: second.rev, block: "108" });
  });

  it("nothing is named for content the server has no block for (as before)", async () => {
    served(110n);
    noteContent(KEY, { head: 109n }, { state: 1 });
    // Content from an older point than the key's (rev "0"), a key the server does not know, a
    // revision never issued, a dev node's 'latest' (noted at 0).
    noteContent("tx:0x02", { head: 0n }, { mined: false });
    const touchedOnDev = noteContent("tx:0x02", { head: 0n }, { mined: true });
    touchRev("tx:0x02");
    const answer = await beat([
      { key: KEY, rev: "0" },
      { key: "list:upgrades", rev: "3" },
      { key: KEY, rev: "999999" },
      touchedOnDev,
    ]);
    expect(answer.notedAt).toEqual({});
  });
});
