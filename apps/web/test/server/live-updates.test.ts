import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { latestBlock, resetRpcClients } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import {
  type SafeCheck,
  heldSafeListing,
  pageSafeListing,
  safeStoreStatus,
} from "@/.server/safe/store";
import {
  type SignatureSetParams,
  signatureSetsStatus,
  simulate,
  verifyPageSignatureSet,
  verifySignatureSet,
  watchSignatureSet,
  watchedSetMembers,
} from "@/.server/signatures";
import { loadEmergencyList } from "@/.server/flows/emergency";
import { emergencyListContent, idContent, statusContent } from "@/.server/sync/content";
import { noteOnScreenContent, resetContent } from "@/.server/sync/content-engine";
import { noteRequest, stopSync, syncEngineStatus, wakeSync } from "@/.server/sync/engine";
import { type RequestInfo, presence, resetPresence, watchKeys } from "@/.server/sync/presence";
import { pageReceipt, receiptContent } from "@/.server/sync/receipt";
import { compareRevs, currentRev, noteContent } from "@/.server/sync/revs";
import { appStatus } from "@/.server/status";
import { currentUpgradeStatus } from "@/.server/upgrade-status";
import { type BeatAnswer, action as beatAction } from "@/routes/resources+/presence";
import { action as safeCheck } from "@/routes/resources+/safe-check";
import { emergencyUpgradeBoardAbi } from "@/common/abis";
import { buildTypedData } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, encodeFunctionData } from "viem";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRpcError } from "../support/fake-jsonrpc";
import {
  FAKE_PINS,
  G_MEMBERS,
  L1,
  type L1Call,
  REVERTS,
  SC_MEMBERS,
  fakeReceipt,
} from "../support/fake-l1";
import {
  EUB_DOMAIN,
  HEAD,
  HEAD_TIME,
  NOW,
  SLOT_MS,
  backfilled,
  ecdsa,
  liveWorld,
  settle,
  until,
} from "../support/live-world";

// Pages update themselves (Phase D3): what a page shows has a revision (sync/revs.ts) the tab
// beats with; the engine notes each on-screen item's content at every served head, and when a
// member Safe's listing changes, so a tab learns from its next beat that something changed and
// reloads from memory. Safe is asked about the Safes the screen depends on (an open set's members
// not valid yet), and "Fetch signatures" reads a set's Safes now. Driven by the fake L1 node and
// Safe service of the live world, the server's own engine (a page load starts it), fake timers.

// With a key: Safe allows 5 requests/s, and the watcher asks every minute.
vi.hoisted(() => {
  process.env.SAFE_API_KEY = "test-key";
});
afterAll(() => {
  process.env.SAFE_API_KEY = undefined;
});

const ID: Hex = `0x${"5a".repeat(32)}`;

/** The Security Council's approval of a waiting upgrade: a set that can still be signed. */
const openSet = (): SignatureSetParams => ({
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup: "securityCouncil",
  typedData: buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: L1.securityCouncil },
    { id: ID }
  ),
  members: [...SC_MEMBERS],
  threshold: 2,
  check: { kind: "multisig", contract: L1.securityCouncil },
  open: true,
});

const pageGet = (path: string): RequestInfo => ({
  method: "GET",
  path,
  header: () => undefined,
});

/** A visible tab beats with these items (the revisions it rendered). */
const beat = (items: { key: string; rev: string | null }[]) =>
  presence().beat({ tab: "tab-under-test", reason: "interval", items });

/** Upstream requests since `from`: L1 posts, verdict sub-calls and direct verdicts, Safe GETs. */
function since(
  w: ReturnType<typeof liveWorld>,
  from: { posts: number; calls: number; safe: number }
) {
  const calls = w.fake.calls.slice(from.calls);
  const safe = w.safeRequests.slice(from.safe);
  return {
    posts: w.fake.posts.length - from.posts,
    verdicts: calls.filter((c) => c.functionName === "checkSignatures").length,
    directVerdicts: calls.filter((c) => c.functionName === "checkSignatures" && !c.viaMulticall)
      .length,
    checks: safe.filter((u) => u.includes("ordering=-modified")).length,
    listings: safe.filter((u) => u.includes("ordering=-created")).length,
    safe: safe.length,
  };
}
const mark = (w: ReturnType<typeof liveWorld>) => ({
  posts: w.fake.posts.length,
  calls: w.fake.calls.length,
  safe: w.safeRequests.length,
});

/** The page loads (the engine starts), shows the set, and its tab beats what it rendered. */
async function openPage(params = openSet()) {
  await backfilled();
  noteRequest(pageGet(`/app/proposals/${ID}`));
  watchSignatureSet(params);
  const set = await settle(verifyPageSignatureSet(params));
  beat([set.watch as { key: string; rev: string | null }]);
  await until(() => syncEngineStatus().ticks >= 1);
  return set;
}

/** The fake chain moves one block on (12 s), the tab beating as it does every 10 s. */
async function nextBlock(
  w: ReturnType<typeof liveWorld>,
  item: { key: string; rev: string | null }
) {
  w.nextBlock();
  await vi.advanceTimersByTimeAsync(SLOT_MS);
  beat([item]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
  resetPresence({ keepWarmMs: 30_000 });
  resetVerdicts();
  resetContent();
  overrideCodePinsForTests(FAKE_PINS);
});

afterEach(() => {
  stopSync();
  overrideCodePinsForTests(undefined);
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("C-3: a member signs while the page is open", () => {
  it("one changed-listing read, the new signature's verdicts, a new revision, and a reload from memory", async () => {
    const w = liveWorld();
    const params = openSet();
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, ecdsa(901));
    const first = await openPage(params);
    expect(first.members.map((m) => m.status)).toEqual(["valid", "missing", "missing"]);
    let item = first.watch as { key: string; rev: string };
    // The watcher asks about the two members not valid yet, never the valid one.
    for (let i = 0; i < 8; i++) await nextBlock(w, item);
    expect(safeStoreStatus().watched).toMatchObject({ safes: 2, cadenceMs: { set: 60_000 } });
    expect(compareRevs([item])).toEqual({ changed: [], unknown: [] });
    const quiet = w.safeRequests.filter((u) => u.includes((SC_MEMBERS[0] as Address).slice(2)));
    expect(quiet.filter((u) => u.includes("ordering=-modified"))).toEqual([]);

    // The second member signs in its Safe.
    w.signInSafe(SC_MEMBERS[1] as Address, params.typedData, ecdsa(902));
    const from = mark(w);
    // Within its minute the watcher sees the change; the set is verified again at the served
    // head, and its revision moves.
    let blocks = 0;
    for (let i = 0; i < 6 && compareRevs([item]).changed.length === 0; i++) {
      await nextBlock(w, item);
      blocks++;
    }
    expect(compareRevs([item]).changed).toEqual([item.key]);
    const cost = since(w, from);
    // One listing read (the changed Safe's); the rest small change checks.
    expect(cost.listings).toBe(1);
    expect(cost.directVerdicts).toBe(0);
    // One verdict read per signature (and per threshold check) at each head, in the head's
    // aggregate: the change re-verifies the set once, never twice at a head.
    const verdictReads = new Map<string, number>();
    for (const call of w.fake.calls.slice(from.calls))
      if (call.functionName === "checkSignatures") {
        const read = `${call.block}:${(call.args[1] as string[]).join(",")}`;
        verdictReads.set(read, (verdictReads.get(read) ?? 0) + 1);
      }
    expect(Math.max(...verdictReads.values())).toBe(1);
    // At most both members' signatures and the threshold check at each head.
    expect(cost.verdicts).toBeLessThanOrEqual(blocks * 3);

    // The tab reloads: the page's set at the served head, from memory.
    const reload = mark(w);
    const after = await settle(verifyPageSignatureSet(params));
    expect(since(w, reload)).toMatchObject({ posts: 0, safe: 0 });
    expect(after.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(after.thresholdCheck.status).toBe("met");
    expect(after.watch?.rev).toBe(currentRev(item.key));
    item = after.watch as { key: string; rev: string };
    expect(compareRevs([item])).toEqual({ changed: [], unknown: [] });
    // Now one member is left to sign: only its Safe is watched.
    await nextBlock(w, item);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(safeStoreStatus().watched).toMatchObject({ safes: 1 });
  });
});

describe("S-29: what the watcher asks about follows the set's latest result", () => {
  it("drops a member once valid, takes it back when it stops being valid, and none of a set that cannot be signed until it can again", async () => {
    const w = liveWorld();
    const params = openSet();
    const signature = ecdsa(911);
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, signature);
    await openPage(params);
    const lower = (list: Address[]) => list.map((a) => a.toLowerCase()).sort();
    expect(lower(watchedSetMembers())).toEqual(lower(SC_MEMBERS.slice(1) as Address[]));

    // The member's Safe changes owners: its signature no longer counts (the contract rejects
    // it). The next head's verification (the engine's) says so, and the member is watched again.
    w.signatures.delete(`${SC_MEMBERS[0]}:${signature}`.toLowerCase());
    const item = (await settle(verifyPageSignatureSet(params))).watch as {
      key: string;
      rev: string;
    };
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    beat([item]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lower(watchedSetMembers())).toEqual(lower(SC_MEMBERS as Address[]));
    // The tab learns it: the set's content changed.
    expect(compareRevs([item]).changed).toEqual([item.key]);

    // The set can no longer be signed (a page shows it closed): nothing of it is watched...
    watchSignatureSet({ ...params, open: false });
    expect(watchedSetMembers()).toEqual([]);
    // ...until it can be again.
    watchSignatureSet(params);
    expect(lower(watchedSetMembers())).toEqual(lower(SC_MEMBERS as Address[]));
  });
});

describe("S-29: a valid member whose Safe copy is older than 60 s stops being valid", () => {
  it("the page learns it within a block and a beat, the member is watched again, and the next heads verify the set from the copy the watcher confirmed", async () => {
    const w = liveWorld();
    const params = openSet();
    const signature = ecdsa(951);
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, signature);
    w.signInSafe(SC_MEMBERS[1] as Address, params.typedData, ecdsa(952));
    const first = await openPage(params);
    expect(first.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(first.thresholdCheck.status).toBe("met");
    const item = first.watch as { key: string; rev: string };
    // Ten blocks with the tab beating: the valid members are not watched, so their copies are
    // now more than 60 s old (a page may still use them, only while they stay valid).
    for (let i = 0; i < 10; i++) await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    const lower = (list: Address[]) => list.map((a) => a.toLowerCase()).sort();
    expect(lower(watchedSetMembers())).toEqual(lower([SC_MEMBERS[2] as Address]));

    // Member 0's Safe changes owners: the contract no longer accepts its signature.
    w.signatures.delete(`${SC_MEMBERS[0]}:${signature}`.toLowerCase());
    // Within one block and one beat the page is told, and the member is watched again.
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    beat([item]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(compareRevs([item]).changed).toEqual([item.key]);
    expect(lower(watchedSetMembers())).toContain((SC_MEMBERS[0] as string).toLowerCase());

    // The watcher confirms member 0's copy; the next heads verify the set (not left to requests).
    for (let i = 0; i < 3; i++) await nextBlock(w, item);
    expect(signatureSetsStatus().lastRecompute).toMatchObject({ verified: 1, skipped: 0 });
    // The tab's reload: member 0 not valid, the threshold not met, from memory.
    const reload = mark(w);
    const after = await settle(verifyPageSignatureSet(params));
    expect(since(w, reload)).toMatchObject({ posts: 0, safe: 0 });
    expect(after.members.map((m) => m.status)).toEqual(["invalid", "valid", "missing"]);
    expect(after.thresholdCheck.status).toBe("below");
    const now = after.watch as { key: string; rev: string };
    expect(now.rev).toBe(currentRev(item.key));
    expect(compareRevs([now])).toEqual({ changed: [], unknown: [] });
    expect(lower(watchedSetMembers())).toEqual(
      lower([SC_MEMBERS[0] as Address, SC_MEMBERS[2] as Address])
    );
  });
});

describe("S-5: a set that can be signed only until a time (a freeze request's validUntil)", () => {
  it("at the first served head past it, its page is told to reload and its members are no longer watched", async () => {
    const w = liveWorld();
    // Each new block is timestamped as it is made (12 s apart): the third is past this.
    const params = { ...openSet(), openUntil: HEAD_TIME + 21n };
    const first = await openPage(params);
    const item = first.watch as { key: string; rev: string };
    const lower = (list: Address[]) => list.map((a) => a.toLowerCase()).sort();
    expect(lower(watchedSetMembers())).toEqual(lower(SC_MEMBERS as Address[]));
    // Two blocks: still open.
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    expect(watchedSetMembers()).toHaveLength(3);
    // The third block's timestamp is past it: the page reloads (and shows it closed), and
    // nothing of it is watched any more.
    await nextBlock(w, item);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(compareRevs([item]).changed).toEqual([item.key]);
    expect(watchedSetMembers()).toEqual([]);
  });
});

describe("S-16: a signature supplied in the URL (?sig=)", () => {
  it("is never part of a key or a revision, and is checked at the head on every load", async () => {
    const w = liveWorld();
    const params = openSet();
    const base = await openPage(params);
    const rev = currentRev((base.watch as { key: string }).key);
    const supplied = { signer: SC_MEMBERS[2] as Address, signature: ecdsa(921) };
    w.signatures.add(`${supplied.signer}:${supplied.signature}`.toLowerCase());
    for (let load = 0; load < 2; load++) {
      const from = mark(w);
      const set = await settle(verifyPageSignatureSet({ ...params, supplied: [supplied] }));
      // The base set's key, no revision of its own; the base revision untouched.
      expect(set.watch).toEqual({ key: (base.watch as { key: string }).key, rev: null });
      expect(currentRev((base.watch as { key: string }).key)).toBe(rev);
      expect(set.members[2]).toMatchObject({ status: "valid", source: "supplied" });
      // Checked afresh each time, directly.
      expect(since(w, from).directVerdicts).toBeGreaterThanOrEqual(1);
    }
    // Nothing about it in what the tab beats.
    expect(JSON.stringify([...presence().onScreen()])).not.toContain(
      supplied.signature.slice(2, 20)
    );
  });
});

/** The tab's beat through the route (as components/presence.tsx sends it): the whole answer. */
async function beatThroughRoute(items: { key: string; rev: string | null }[]) {
  const response = (await beatAction({
    request: new Request("http://localhost/resources/presence", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ tab: "tab-under-test", reason: "interval", items }),
    }),
    params: {},
    context: {},
  } as never)) as Response;
  return (await response.json()) as BeatAnswer;
}

describe("a set the engine could not verify at the served head (D2: current at M only if read at M)", () => {
  it("the beat names the head its content was last verified at, behind the served head while its reads fail; never for content the tab no longer shows, nor for a ?sig= page", async () => {
    const failing = { on: false };
    const w = liveWorld({
      inject: (call) =>
        failing.on && call.functionName === "checkSignatures"
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    const params = openSet();
    const sig0 = ecdsa(801);
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, sig0);
    w.signInSafe(SC_MEMBERS[1] as Address, params.typedData, ecdsa(802));
    const first = await openPage(params);
    expect(first.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(first.thresholdCheck.status).toBe("met");
    const item = first.watch as { key: string; rev: string };
    // Verified again at each served head with the same content: named at that head.
    for (let i = 0; i < 3; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      const answer = await beatThroughRoute([item]);
      expect(answer.changed).toEqual([]);
      expect(answer.verifiedAt[item.key]).toEqual({ rev: item.rev, block: answer.head?.number });
    }
    const lastGood = w.head().toString();

    // Member 0's signature stops counting on-chain, and the verdict reads fail from now on.
    w.signatures.delete(`${SC_MEMBERS[0]}:${sig0}`.toLowerCase());
    failing.on = true;
    let answer = await beatThroughRoute([item]);
    for (let i = 0; i < 4; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      answer = await beatThroughRoute([item]);
      // Nothing changed that the engine could see, but the tab is told its set was last verified
      // at an older block than the head served: the page shows it as of that block.
      expect(answer.changed).toEqual([]);
      expect(BigInt(answer.head?.number as string)).toBeGreaterThan(BigInt(lastGood));
      expect(answer.verifiedAt[item.key]).toEqual({ rev: item.rev, block: lastGood });
    }
    expect(signatureSetsStatus().lastRecompute).toMatchObject({ failed: 1 });
    // JSON at that head: an error, as before (never the old verdict).
    await expect(settle(verifySignatureSet(params))).rejects.toThrow(/internal error|-32603/);

    // A tab showing other content than the current (a revision before a change, or none yet):
    // nothing named for it, neither the block nor how its Safes are checked.
    const other = await beatThroughRoute([{ key: item.key, rev: "0" }]);
    expect(other.verifiedAt[item.key]).toBeUndefined();
    expect(other.checked[item.key]).toBeUndefined();
    expect(answer.checked[item.key]).toMatchObject({ state: "watching" });

    // The reads answer again: the content at the next head differs (member 0 no longer valid),
    // and the tab is told to reload.
    failing.on = false;
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    answer = await beatThroughRoute([item]);
    expect(answer.changed).toEqual([item.key]);
    expect(answer.verifiedAt[item.key]).toBeUndefined();
    const after = await settle(verifyPageSignatureSet(params));
    expect(after.members[0]?.status).not.toBe("valid");
    const reloaded = await beatThroughRoute([after.watch as { key: string; rev: string }]);
    expect(reloaded.verifiedAt[item.key]).toEqual({
      rev: after.watch?.rev,
      block: reloaded.head?.number,
    });

    // A page with a signature from its URL: its set is keyed without it and has no revision, so
    // the beat never names it as current (the page shows it as of its load's block).
    const supplied = await settle(
      verifyPageSignatureSet({
        ...params,
        supplied: [{ signer: SC_MEMBERS[2] as Address, signature: ecdsa(803) }],
      })
    );
    expect(supplied.watch).toEqual({ key: item.key, rev: null });
    expect(supplied.verifiedAtBlock).toBe(w.head().toString());
    const sig = await beatThroughRoute([supplied.watch as { key: string; rev: null }]);
    expect(sig.verifiedAt).toEqual({});
    expect(sig.checked).toEqual({});
  });
});

describe("every item on screen says the head its content was noted at (notedAt), like sets", () => {
  it("the status, an upgrade's state, a list and a receipt: named at the served head while read there; behind it, at the block last read, while the head's reads fail; nothing for content the tab no longer shows", async () => {
    const failing = { on: false };
    const hash: Hex = `0x${"7e".repeat(32)}`;
    const w = liveWorld({
      // Every contract read fails (an RPC fault), and so does the receipt's.
      aggregateError: () => (failing.on ? new FakeRpcError(-32603, "internal error") : undefined),
      inject: () => (failing.on ? new FakeRpcError(-32603, "internal error") : undefined),
      receipt: () =>
        failing.on ? new FakeRpcError(-32603, "internal error") : fakeReceipt(hash, HEAD - 2n),
    });
    w.upgrades.set(ID.toLowerCase(), {
      state: UPGRADE_STATES.LegalVetoPeriod,
      status: [1_790_000_000, 0, false, false, false],
    });
    await backfilled();
    noteRequest(pageGet(`/app/proposals/${ID}`));
    const head = await settle(latestBlock());
    const loaded = await settle(appStatus({ freshness: "page" }));
    if (!loaded.ok) throw new Error(loaded.error);
    const items = [
      noteContent(
        "status",
        { head: BigInt(loaded.governance.latestBlock.number) },
        statusContent(loaded)
      ),
      noteContent(
        watchKeys.upgrade(ID),
        { head: head.number },
        idContent(await settle(currentUpgradeStatus(ID)))
      ),
      noteContent(
        watchKeys.tx(hash),
        { head: head.number },
        receiptContent(await settle(pageReceipt(hash)))
      ),
    ];
    beat(items);
    await until(() => syncEngineStatus().ticks >= 1);
    let answer = await beatThroughRoute(items);
    for (let i = 0; i < 3; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      answer = await beatThroughRoute(items);
      expect(answer.changed).toEqual([]);
      for (const item of items)
        expect(answer.notedAt[item.key]).toEqual({ rev: item.rev, block: answer.head?.number });
    }
    const lastGood = answer.head?.number as string;
    // The upgrade's legal veto ends at the next block, and every read fails from now on: none
    // of it is read again at the new heads, and the tab is told so (never the old as current).
    w.upgrades.set(ID.toLowerCase(), {
      state: UPGRADE_STATES.Waiting,
      status: [1_790_000_000, 0, false, false, false],
    });
    failing.on = true;
    for (let i = 0; i < 4; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      answer = await beatThroughRoute(items);
      expect(answer.changed).toEqual([]);
      expect(BigInt(answer.head?.number as string)).toBeGreaterThan(BigInt(lastGood));
      for (const item of items)
        expect(answer.notedAt[item.key]).toEqual({ rev: item.rev, block: lastGood });
    }
    // A tab showing other content than the current: nothing named for it.
    const other = await beatThroughRoute(items.map((item) => ({ key: item.key, rev: "0" })));
    expect(other.notedAt).toEqual({});
    // The reads answer again: the upgrade's new state is learnt (the tab reloads), the rest is
    // named at the head again.
    failing.on = false;
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    answer = await beatThroughRoute(items);
    expect(answer.changed).toEqual([watchKeys.upgrade(ID)]);
    expect(answer.notedAt.status).toEqual({ rev: items[0]?.rev, block: answer.head?.number });
    expect(answer.notedAt[watchKeys.tx(hash)]).toEqual({
      rev: items[2]?.rev,
      block: answer.head?.number,
    });
  });

  it("a beat while the content pass at a new head runs names the head before it (for 2 s at most), so nothing reads as not re-read only because its pass had not finished", async () => {
    const hash: Hex = `0x${"7f".repeat(32)}`;
    // The receipt (above the finality boundary: read at each head) answers slowly when asked to.
    const slow = { ms: 0 };
    const w = liveWorld({
      receipt: () => fakeReceipt(hash, HEAD - 2n),
      delayMs: (post) =>
        post.calls.some((call) => call.method === "eth_getTransactionReceipt") ? slow.ms : 0,
    });
    await backfilled();
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const head = await settle(latestBlock());
    const item = noteContent(
      watchKeys.tx(hash),
      { head: head.number },
      receiptContent(await settle(pageReceipt(hash)))
    );
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    await nextBlock(w, item);
    const before = (await beatThroughRoute([item])).head?.number as string;
    /** A new block, run until the engine serves it; then the tab beats at once. */
    const served = async () => {
      w.nextBlock();
      const next = w.head().toString();
      await until(
        () => syncEngineStatus().head?.number === next && !!syncEngineStatus().head?.servedAt,
        13_000
      );
      return next;
    };
    // The content pass at the new head takes 1 s (the receipt's read): meanwhile the beat names
    // the head before it, at which the receipt was read; then the new one.
    slow.ms = 1_000;
    let next = await served();
    let answer = await beatThroughRoute([item]);
    expect(answer.head?.number).toBe(before);
    expect(answer.notedAt[item.key]?.block).toBe(before);
    await vi.advanceTimersByTimeAsync(1_200);
    answer = await beatThroughRoute([item]);
    expect(answer.head?.number).toBe(next);
    expect(answer.notedAt[item.key]?.block).toBe(next);
    // A pass slower than 2 s: the new head is named after 2 s, and the receipt as of the block
    // before it until its read there is done.
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    slow.ms = 6_000;
    const previous = (await beatThroughRoute([item])).head?.number as string;
    next = await served();
    expect((await beatThroughRoute([item])).head?.number).toBe(previous);
    await vi.advanceTimersByTimeAsync(2_100);
    answer = await beatThroughRoute([item]);
    expect(answer.head?.number).toBe(next);
    expect(answer.notedAt[item.key]?.block).toBe(previous);
    await vi.advanceTimersByTimeAsync(5_000);
    answer = await beatThroughRoute([item]);
    expect(answer.notedAt[item.key]?.block).toBe(next);
  });
});

describe("an open set while Safe answers nothing (this IP's monthly quota used up)", () => {
  it("is verified at every served head as a request would give it (members Safe cannot answer for unavailable, never missing), so the beat never leaves it behind the head", async () => {
    const w = liveWorld();
    const params = openSet();
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, ecdsa(811));
    const first = await openPage(params);
    expect(first.members.map((m) => m.status)).toEqual(["valid", "missing", "missing"]);
    let item = first.watch as { key: string; rev: string };
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    // Safe's quota is used up: the watcher's next check gets a 429, and from then on every
    // request to Safe fails at once until the quota resets.
    w.safeQuota.exhausted = true;
    const behind: string[] = [];
    let reloads = 0;
    for (let i = 0; i < 15; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      let answer = await beatThroughRoute([item]);
      if (answer.changed.includes(item.key)) {
        // The content changed (the members now unavailable): the tab reloads, from memory.
        reloads++;
        const reloaded = await settle(verifyPageSignatureSet(params));
        expect(reloaded.members.map((m) => m.status)).toEqual([
          "valid",
          "unavailable",
          "unavailable",
        ]);
        item = reloaded.watch as { key: string; rev: string };
        answer = await beatThroughRoute([item]);
      }
      const at = answer.verifiedAt[item.key]?.block;
      if (at !== answer.head?.number) behind.push(answer.head?.number as string);
    }
    expect(reloads).toBe(1);
    expect(behind).toEqual([]);
    // The label says why Safe is not checked.
    expect((await beatThroughRoute([item])).checked[item.key]).toMatchObject({
      state: "paused",
      reason: "quota-exhausted",
    });
  });
});

describe("R-D4: JSON never answers with a page's result from a copy older than 60 s", () => {
  it("a page result the engine computed from a watched copy past 60 s (the page rule) is not JSON's at the same head: JSON reads that Safe itself", async () => {
    const w = liveWorld();
    const params = openSet();
    const shown = await openPage(params);
    const item = shown.watch as { key: string; rev: string };
    const member = SC_MEMBERS[2] as Address;
    // Safe stops answering for one member: the watcher's checks of it fail, its copy ages.
    w.safeFailing.add(member.toLowerCase());
    const age = () => Date.now() - (heldSafeListing(member)?.fetchedAt as number);
    while (age() <= 60_000) await nextBlock(w, item);
    // Past 60 s, within the page rule (its cadence and 10 s): the engine verified the set at
    // this head from it; a page's reload takes that result from memory.
    expect(age()).toBeLessThanOrEqual(70_000);
    expect(pageSafeListing(member, "set")).not.toBeNull();
    const from = mark(w);
    const page = await settle(verifyPageSignatureSet(params));
    expect(since(w, from).safe).toBe(0);
    expect(page.members[2]?.status).toBe("missing");
    expect(page.verifiedAtBlock).toBe(w.head().toString());
    // JSON at the same head: never that result; it reads the member's Safe (which fails, so the
    // member is unavailable, never missing from the old copy).
    const strict = await settle(verifySignatureSet(params));
    expect(strict.verifiedAtBlock).toBe(w.head().toString());
    expect(since(w, from).safe).toBeGreaterThan(0);
    expect(strict.members[2]?.status).toBe("unavailable");
    expect(strict.stale).not.toBe(true);
  });
});

describe("S-24: what moves a revision", () => {
  it("a set's: its signatures and verdicts, never its labels; the same content at a new head keeps it", () => {
    const key = "set:00000000000000000000000000000001";
    const content = { members: [{ member: "0x1", status: "missing" }], thresholdCheck: "below" };
    const r1 = noteContent(key, { head: 100n, order: 1 }, content).rev;
    expect(noteContent(key, { head: 101n, order: 1 }, { ...content }).rev).toBe(r1);
    const signed = { members: [{ member: "0x1", status: "valid" }], thresholdCheck: "below" };
    const r2 = noteContent(key, { head: 101n, order: 2 }, signed).rev;
    expect(r2).not.toBe(r1);
    // Content from an older point that differs is never current: its page reloads.
    expect(noteContent(key, { head: 101n, order: 1 }, content).rev).toBe("0");
    expect(compareRevs([{ key, rev: r1 }]).changed).toEqual([key]);
    expect(compareRevs([{ key, rev: r2 }]).changed).toEqual([]);
    // A key without a revision (nothing rendered yet) is neither changed nor unknown; an unknown
    // key (a restart) is.
    expect(
      compareRevs([
        { key, rev: null },
        { key: "set:ff", rev: "4" },
      ])
    ).toEqual({
      changed: [],
      unknown: ["set:ff"],
    });
  });

  it("an upgrade's: its state when a time boundary passes (no log), from the head's snapshot", async () => {
    const w = liveWorld();
    w.upgrades.set(ID.toLowerCase(), {
      state: UPGRADE_STATES.LegalVetoPeriod,
      status: [1_790_000_000, 0, false, false, false],
    });
    await backfilled();
    noteRequest(pageGet(`/app/proposals/${ID}`));
    const key = watchKeys.upgrade(ID);
    const loaded = await settle(currentUpgradeStatus(ID));
    const rev = noteContent(key, { head: (await settle(latestBlock())).number }, idContent(loaded));
    beat([rev]);
    await until(() => syncEngineStatus().ticks >= 1);
    for (let i = 0; i < 3; i++) await nextBlock(w, rev);
    expect(compareRevs([rev]).changed).toEqual([]);
    // The legal veto period ends: the handler answers Waiting from the next block on.
    w.upgrades.set(ID.toLowerCase(), {
      state: UPGRADE_STATES.Waiting,
      status: [1_790_000_000, 0, false, false, false],
    });
    await nextBlock(w, rev);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(compareRevs([rev]).changed).toEqual([key]);
  });

  it("the status: a governance value that changes without a log (the Guardians' nonce), never the block it was read at", async () => {
    // From block `change` on, the Guardians' nonce is 7 (a veto used it; no log at the Guardians).
    let change = Number.POSITIVE_INFINITY;
    const w = liveWorld({
      answer: (call) =>
        call.functionName === "nonce" &&
        call.block !== "latest" &&
        Number(BigInt(call.block)) >= change
          ? 7n
          : undefined,
    });
    await backfilled();
    noteRequest(pageGet("/"));
    const loaded = await settle(appStatus({ freshness: "page" }));
    if (!loaded.ok) throw new Error(loaded.error);
    const status = noteContent(
      "status",
      { head: BigInt(loaded.governance.latestBlock.number) },
      statusContent(loaded)
    );
    beat([status]);
    await until(() => syncEngineStatus().ticks >= 1);
    for (let i = 0; i < 3; i++) await nextBlock(w, status);
    expect(compareRevs([status]).changed).toEqual([]);
    // A veto used the Guardians' nonce at the next block.
    change = Number(w.head() + 1n);
    await nextBlock(w, status);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(compareRevs([status]).changed).toEqual(["status"]);
  });

  it("a transaction's: its receipt once found (read once per head while its page is on screen)", async () => {
    const w = liveWorld();
    await backfilled();
    const hash: Hex = `0x${"7c".repeat(32)}`;
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const key = watchKeys.tx(hash);
    const head = await settle(latestBlock());
    const notMined = noteContent(key, { head: head.number }, null);
    beat([notMined]);
    await until(() => syncEngineStatus().ticks >= 1);
    for (let i = 0; i < 2; i++) await nextBlock(w, notMined);
    expect(compareRevs([notMined]).changed).toEqual([]);
    const receipts = () =>
      w.fake.posts.flatMap((p) => p.calls).filter((c) => c.method === "eth_getTransactionReceipt")
        .length;
    expect(receipts()).toBeGreaterThanOrEqual(2);
    // Off screen: no more receipt reads.
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    const before = receipts();
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(receipts()).toBe(before);
    // Content assembled the same way twice gives the same revision.
    expect(noteContent(key, { head: head.number + 10n }, null).rev).toBe(notMined.rev);
    await settle(noteOnScreenContent(head, [], () => true));
  });
});

describe("S-24: a list fed by Safe (pending emergency upgrades)", () => {
  it("a new pending id in a member's Safe moves the list's revision within the list cadence (the watcher), and at once with Check Safe now; the reload's content is the engine's (no reload loop)", async () => {
    const w = liveWorld();
    await backfilled();
    noteRequest(pageGet("/app/emergency"));
    const key = watchKeys.emergencies(false);
    /** The page's loader: the list it sends, noted at the head served as it starts. */
    const load = async () => {
      const head = await settle(latestBlock());
      const list = loadEmergencyList({ freshness: "page" });
      const [pending, executed] = await settle(Promise.all([list.freshPending, list.executed]));
      return {
        pending,
        item: noteContent(key, { head: head.number }, emergencyListContent(pending, executed)),
      };
    };
    let { pending, item } = await load();
    expect(pending.pending).toEqual([]);
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    for (let i = 0; i < 3; i++) await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    // A Security Council member signs a new emergency upgrade in its Safe.
    const id: Hex = `0x${"e1".repeat(32)}`;
    const typedData = (of: Hex) =>
      buildTypedData("ExecuteEmergencyUpgradeSecurityCouncil", EUB_DOMAIN, { id: of });
    w.signInSafe(SC_MEMBERS[0] as Address, typedData(id), ecdsa(961), { listed: true });
    const signedAt = Date.now();
    while (compareRevs([item]).changed.length === 0 && Date.now() - signedAt < 6 * 60_000)
      await nextBlock(w, item);
    // Within the list cadence (5 minutes, and a block).
    expect(compareRevs([item]).changed).toEqual([item.key]);
    expect(Date.now() - signedAt).toBeLessThanOrEqual(5 * 60_000 + SLOT_MS);
    // The page's reload: the new id, and the revision the engine noted (no change to reload for).
    ({ pending, item } = await load());
    expect(pending.pending.map((p) => p.id)).toEqual([id]);
    expect(compareRevs([item]).changed).toEqual([]);
    beat([item]);
    // Another id appears; "Check Safe now" reads the Safes at once and answers the new revision.
    const other: Hex = `0x${"e2".repeat(32)}`;
    w.signInSafe(SC_MEMBERS[1] as Address, typedData(other), ecdsa(962), { listed: true });
    let done: Response | null = null;
    void press(key).then((response) => {
      done = response;
    });
    await until(() => done !== null, 10_000);
    const body = (await (done as unknown as Response).json()) as { rev: string | null };
    expect(body.rev).toBe(currentRev(key));
    expect(body.rev).not.toBe(item.rev);
    expect(compareRevs([item]).changed).toEqual([item.key]);
    // Its reload: both ids, at the revision just answered.
    const after = await load();
    expect(after.pending.pending.map((p) => p.id).sort()).toEqual([id, other].sort());
    expect(after.item.rev).toBe(body.rev);
  });
});

describe("S-24: a simulation a page shows (a transaction ready to send)", () => {
  it("is simulated again at each served head while on screen (one call a block): a new result changes its revision, a failed read changes nothing and is never named as current", async () => {
    // The simulated call (EUB.ZK_FOUNDATION_SAFE(), read directly only by the simulation): from
    // block `reverts` on it reverts; at block `fails` the node fails it (an internal error).
    let reverts = Number.POSITIVE_INFINITY;
    let fails = Number.POSITIVE_INFINITY;
    const simulated = (call: L1Call) =>
      call.functionName === "ZK_FOUNDATION_SAFE" && !call.viaMulticall && call.block !== "latest";
    const w = liveWorld({
      answer: (call) =>
        simulated(call) && Number(BigInt(call.block)) >= reverts ? REVERTS : undefined,
      inject: (call) =>
        simulated(call) && Number(BigInt(call.block)) === fails
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    await backfilled();
    noteRequest(pageGet(`/app/emergency/${ID}`));
    const execution = {
      to: L1.emergencyUpgradeBoard,
      data: encodeFunctionData({
        abi: emergencyUpgradeBoardAbi,
        functionName: "ZK_FOUNDATION_SAFE",
      }),
      value: "0",
    };
    const shown = await settle(simulate(execution, { keep: true, page: true }));
    expect(shown).toMatchObject({ status: "ok", atBlock: HEAD.toString() });
    const item = shown.watch as { key: string; rev: string };
    expect(item.key).toMatch(/^sim:[0-9a-f]{32}$/);
    // JSON's simulation of the same transaction: no key, nothing registered.
    expect((await settle(simulate(execution, { keep: true }))).watch).toBeUndefined();
    const tab = async () => {
      const response = (await beatAction({
        request: new Request("http://localhost/resources/presence", {
          method: "POST",
          headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ tab: "tab-under-test", reason: "interval", items: [item] }),
        }),
        params: {},
        context: {},
      } as never)) as Response;
      return (await response.json()) as BeatAnswer;
    };
    await tab();
    await until(() => syncEngineStatus().ticks >= 1);
    const calls = () => w.fake.calls.filter(simulated).length;
    for (let i = 0; i < 3; i++) {
      const before = calls();
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      const answer = await tab();
      // Once a block, before the head is served: the beat names the served head as simulated.
      expect(calls() - before).toBe(1);
      expect(answer.changed).toEqual([]);
      expect(answer.simulatedAt[item.key]).toBe(answer.head?.number);
    }
    // The node fails the simulation at the next block: nothing noted; the result the tab shows
    // was simulated at the block before, which the beat says (so the page shows it as earlier).
    fails = Number(w.head() + 1n);
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    const failed = await tab();
    expect(failed.changed).toEqual([]);
    expect(failed.head?.number).toBe(w.head().toString());
    expect(failed.simulatedAt[item.key]).toBe((w.head() - 1n).toString());
    // From the next block on the transaction would revert: the tab learns it from its next beat.
    reverts = Number(w.head() + 1n);
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    expect((await tab()).changed).toEqual([item.key]);
    // Its reload: the result at the served head, from memory.
    const reload = mark(w);
    const after = await settle(simulate(execution, { keep: true, page: true }));
    expect(since(w, reload).posts).toBe(0);
    expect(after).toMatchObject({ status: "reverted", atBlock: w.head().toString() });
    expect(after.watch?.rev).toBe(currentRev(item.key));
    // Off screen: no more simulations.
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    await vi.advanceTimersByTimeAsync(40_000);
    const off = calls();
    for (let i = 0; i < 5; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
    }
    expect(calls()).toBe(off);
  });
});

describe("C-1 for the home page's lists with a pending emergency upgrade (from Safe messages) on screen", () => {
  it("one aggregate3 per quiet block: the pending id's state is read in the head's snapshot, not on its own", async () => {
    const w = liveWorld();
    const pending: Hex = `0x${"e1".repeat(32)}`;
    const typedData = buildTypedData("ExecuteEmergencyUpgradeSecurityCouncil", EUB_DOMAIN, {
      id: pending,
    });
    w.signInSafe(SC_MEMBERS[0] as Address, typedData, ecdsa(961), { listed: true });
    await backfilled();
    noteRequest(pageGet("/"));
    // The page's loader: the list from Safe (listings read now), as `/` shows it.
    const list = loadEmergencyList({ freshness: "page" });
    const [fresh, executed] = await settle(Promise.all([list.freshPending, list.executed]));
    expect(fresh.pending.map((p) => p.id)).toEqual([pending]);
    const head = await settle(latestBlock());
    const items = [
      noteContent(
        watchKeys.emergencies(false),
        { head: head.number },
        emergencyListContent(fresh, executed)
      ),
      { key: watchKeys.status, rev: null },
      { key: watchKeys.upgrades(false), rev: null },
      { key: watchKeys.freezes, rev: null },
    ];
    presence().beat({ tab: "tab-under-test", reason: "interval", items });
    await until(() => syncEngineStatus().ticks >= 1);
    // Warm-up: the first heads read what the engine had not read yet.
    for (let i = 0; i < 3; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      presence().beat({ tab: "tab-under-test", reason: "interval", items });
    }
    const from = w.head();
    for (let i = 0; i < 10; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      presence().beat({ tab: "tab-under-test", reason: "interval", items });
    }
    await vi.advanceTimersByTimeAsync(3_000);
    for (let block = from + 1n; block <= from + 10n; block++) {
      const at = `0x${block.toString(16)}`;
      const aggregates = w.fake.aggregates.filter((a) => a.block === at);
      expect(aggregates.length, `aggregate3 calls at block ${block}`).toBe(1);
      // The pending id's state is in it.
      expect(aggregates[0]?.functions).toContain("upgradeStatus");
    }
    const pendingReads = w.fake.calls.filter(
      (c) =>
        c.functionName === "upgradeStatus" &&
        String(c.args[0]).toLowerCase() === pending.toLowerCase() &&
        BigInt(c.block === "latest" ? 0 : c.block) > from
    );
    expect(pendingReads.length).toBe(10);
    expect(compareRevs([items[0] as { key: string; rev: string }]).changed).toEqual([]);
  });
});

describe("a transaction's receipt: once found, never 'not mined' again", () => {
  const hash: Hex = `0x${"7d".repeat(32)}`;
  /** The page's loader: its receipt answer, noted for the tab (as loaderRevs notes it). */
  async function load() {
    const head = await settle(latestBlock());
    const answer = await settle(pageReceipt(hash));
    return {
      answer,
      item: noteContent(watchKeys.tx(hash), { head: head.number }, receiptContent(answer)),
    };
  }

  it("in a final block: kept for good (not read again); a read that fails, or a backend that answers 'not found', changes nothing, and a reload still shows it mined", async () => {
    let answer: "mined" | "error" | "none" = "mined";
    const w = liveWorld({
      receipt: () =>
        answer === "mined"
          ? fakeReceipt(hash, HEAD - 200n)
          : answer === "none"
            ? null
            : new FakeRpcError(-32603, "internal error"),
    });
    await backfilled();
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const { answer: loaded, item } = await load();
    expect(loaded).toMatchObject({ unread: false, receipt: { status: "success" } });
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    answer = "error";
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    answer = "none";
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    // Found once in a final block: not read again at all, and the page's reload shows it mined.
    const receipts = () => w.fake.requests("eth_getTransactionReceipt").length;
    expect(receipts()).toBe(1);
    const reload = await load();
    expect(reload.answer.receipt?.status).toBe("success");
    expect(reload.item.rev).toBe(item.rev);
  });

  it("above the finality boundary: read again at each head; a failed read changes nothing, one that no longer finds it (a reorg) says it could not be read (never 'not mined', never the old block), and a new block is learnt", async () => {
    let answer: "mined" | "moved" | "error" | "none" = "mined";
    const minedAt = HEAD - 2n;
    const w = liveWorld({
      receipt: () =>
        answer === "mined"
          ? fakeReceipt(hash, minedAt)
          : answer === "moved"
            ? fakeReceipt(hash, minedAt + 3n)
            : answer === "none"
              ? null
              : new FakeRpcError(-32603, "internal error"),
    });
    await backfilled();
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const { answer: loaded, item } = await load();
    expect(loaded).toMatchObject({ unread: false, receipt: { blockNumber: minedAt.toString() } });
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    const receipts = () => w.fake.requests("eth_getTransactionReceipt").length;
    // Read at each head while not final (the same receipt: no change).
    const from = receipts();
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    expect(receipts() - from).toBeGreaterThanOrEqual(2);
    expect(compareRevs([item]).changed).toEqual([]);
    answer = "error";
    await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    // A reorg drops it: the tab is told, and its reload says the receipt could not be read.
    answer = "none";
    await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([item.key]);
    const lost = await load();
    expect(lost.answer).toEqual({ receipt: null, unread: true });
    expect(compareRevs([lost.item]).changed).toEqual([]);
    // Mined again in another block: learnt at the next head.
    answer = "moved";
    await nextBlock(w, lost.item);
    expect(compareRevs([lost.item]).changed).toEqual([lost.item.key]);
    const moved = await load();
    expect(moved.answer.receipt?.blockNumber).toBe((minedAt + 3n).toString());
  });

  it("not mined yet: read at each head (a failed read notes nothing), and the tab learns once it is mined", async () => {
    let answer: "mined" | "error" | "none" = "none";
    const w = liveWorld({
      receipt: () =>
        answer === "mined"
          ? fakeReceipt(hash, w.head())
          : answer === "none"
            ? null
            : new FakeRpcError(-32603, "internal error"),
    });
    await backfilled();
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const { answer: loaded, item } = await load();
    expect(loaded).toEqual({ receipt: null, unread: false });
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    answer = "error";
    for (let i = 0; i < 2; i++) await nextBlock(w, item);
    expect(compareRevs([item]).changed).toEqual([]);
    answer = "mined";
    await nextBlock(w, item);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(compareRevs([item]).changed).toEqual([item.key]);
    const reload = await load();
    expect(reload.answer.receipt?.status).toBe("success");
    expect(compareRevs([reload.item]).changed).toEqual([]);
  });

  it("a loader whose read failed says so (not 'not mined'), and the tab learns once a read finds it", async () => {
    let answer: "mined" | "error" = "error";
    const w = liveWorld({
      receipt: () =>
        answer === "mined"
          ? fakeReceipt(hash, w.head())
          : new FakeRpcError(-32603, "internal error"),
    });
    await backfilled();
    noteRequest(pageGet(`/app/transactions/${hash}`));
    const { answer: loaded, item } = await load();
    expect(loaded).toEqual({ receipt: null, unread: true });
    beat([item]);
    await until(() => syncEngineStatus().ticks >= 1);
    answer = "mined";
    await nextBlock(w, item);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(compareRevs([item]).changed).toEqual([item.key]);
  });
});

/** POSTs "Fetch signatures" for `key` from this app's page (or `headers`). */
function press(key: string, headers: Record<string, string> = {}) {
  return safeCheck({
    request: new Request("http://localhost:3000/resources/safe-check", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify({ key }),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

describe("Fetch signatures (POST /resources/safe-check)", () => {
  it("reads the set's member Safes now (whatever their copies' age), verifies it again at the head, and answers its revision; a second press joins the first", async () => {
    const w = liveWorld();
    const params = openSet();
    const set = await openPage(params);
    const key = (set.watch as { key: string }).key;
    // (The page read the three Safes at once: the watcher asks the first about 20 s later, so the
    // three are not all due at the same moment a minute after.)
    await vi.advanceTimersByTimeAsync(15_000);
    // The second member signed a moment ago; the watcher has not asked yet.
    w.signInSafe(SC_MEMBERS[1] as Address, params.typedData, ecdsa(931));
    const from = mark(w);
    const [one, two] = [press(key), press(key)];
    let done = false;
    const both = Promise.all([one, two]).finally(() => {
      done = true;
    });
    await until(() => done, 10_000);
    const [a, b] = await both;
    expect(a.status).toBe(200);
    const body = await a.json();
    expect(await b.json()).toEqual(body);
    expect(body).toMatchObject({ key, checked: 3, failed: 0 });
    // How the set's copies are kept now, for the label at once: just checked.
    expect(body.check).toMatchObject({ state: "watching" });
    expect(Date.now() - Date.parse(body.check.checkedAt)).toBeLessThan(10_000);
    expect(body.rev).toBe(currentRev(key));
    expect(body.rev).not.toBe(set.watch?.rev);
    // Each member Safe asked once (a change check), at once; the changed one's listing read too
    // (and one whose newest message the world's equal timestamps make ambiguous).
    const cost = since(w, from);
    expect(cost.checks).toBe(3);
    const read = w.safeRequests.slice(from.safe).filter((u) => u.includes("ordering=-created"));
    expect(
      read.some((u) => u.toLowerCase().includes((SC_MEMBERS[1] as string).slice(2).toLowerCase()))
    ).toBe(true);
    expect(read.length).toBeLessThanOrEqual(2);
    // The page's reload: from memory.
    const reload = mark(w);
    const after = await settle(verifyPageSignatureSet(params));
    expect(after.members.map((m) => m.status)).toEqual(["missing", "valid", "missing"]);
    expect(since(w, reload)).toMatchObject({ posts: 0, safe: 0 });
    expect(pageSafeListing(SC_MEMBERS[1] as Address, "set")).not.toBeNull();
  });

  it("only from this app's pages, as JSON, for a key a page showed", async () => {
    liveWorld();
    await backfilled();
    expect(
      (await press("set:00000000000000000000000000000000", { "sec-fetch-site": "cross-site" }))
        .status
    ).toBe(403);
    expect((await press("../etc", {})).status).toBe(400);
    expect((await press("set:00000000000000000000000000000000")).status).toBe(404);
    // A body over 1 KB is refused without being read whole (declared, or streamed).
    const big = (declare: boolean) =>
      safeCheck({
        request: new Request("http://localhost:3000/resources/safe-check", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            ...(declare ? { "content-length": "4096" } : {}),
          },
          body: JSON.stringify({ key: "list:vetoes", pad: "x".repeat(4_000) }),
        }),
        params: {},
        context: {},
      } as never) as Promise<Response>;
    expect((await big(true)).status).toBe(413);
    expect((await big(false)).status).toBe(413);
    // Pressing counts as use (the engine starts); let it settle before the next test.
    await vi.advanceTimersByTimeAsync(5_000);
  });

  it("asks Safe nothing without a press or a page on screen: the watcher only while someone uses the app", async () => {
    const w = liveWorld();
    const params = openSet();
    await openPage(params);
    // The tab leaves; the keep-warm runs out.
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    await vi.advanceTimersByTimeAsync(40_000);
    const from = mark(w);
    for (let i = 0; i < 30; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
    }
    expect(since(w, from)).toMatchObject({ safe: 0, posts: 0 });
  });
});

describe("an open set's page next to a list fed by Safe (two visible tabs)", () => {
  it("the set's members stay within the page bound while the list's Safes are watched too, so the beat never reports the set behind while nothing changed", async () => {
    const w = liveWorld();
    const params = openSet();
    w.signInSafe(SC_MEMBERS[0] as Address, params.typedData, ecdsa(901));
    await backfilled();
    // Tab two: the emergency list (the Safes of the Council, the Guardians and the Foundation).
    noteRequest(pageGet("/app/emergency"));
    const key = watchKeys.emergencies(false);
    const head = await settle(latestBlock());
    const list = loadEmergencyList({ freshness: "page" });
    const [pending, executed] = await settle(Promise.all([list.freshPending, list.executed]));
    const listItem = noteContent(
      key,
      { head: head.number },
      emergencyListContent(pending, executed)
    );
    // Tab one: the open set.
    noteRequest(pageGet(`/app/proposals/${ID}`));
    watchSignatureSet(params);
    const set = await settle(verifyPageSignatureSet(params));
    const setItem = set.watch as { key: string; rev: string };
    presence().beat({ tab: "tab-two-under-test", reason: "interval", items: [listItem] });
    presence().beat({ tab: "tab-one-under-test", reason: "interval", items: [setItem] });
    await until(() => syncEngineStatus().ticks >= 1);
    const tabBeat = async (tab: string, items: { key: string; rev: string | null }[]) => {
      const response = (await beatAction({
        request: new Request("http://localhost/resources/presence", {
          method: "POST",
          headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ tab, reason: "interval", items }),
        }),
        params: {},
        context: {},
      } as never)) as Response;
      return (await response.json()) as BeatAnswer;
    };
    const behind: number[] = [];
    for (let i = 0; i < 100; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      await tabBeat("tab-two-under-test", [listItem]);
      const answer = await tabBeat("tab-one-under-test", [setItem]);
      expect(answer.changed).toEqual([]);
      const at = answer.verifiedAt[setItem.key]?.block;
      if (!at || BigInt(at) < BigInt(answer.head?.number as string)) behind.push(i);
    }
    expect(behind).toEqual([]);
    expect(safeStoreStatus().watched).toMatchObject({ safes: 2, lists: 5 });
  });
});

describe("a list fed by Safe on screen (the veto list)", () => {
  it("each beat's answer says when its Safes were checked and when they are next, moving with every check although the list stays the same (no reload)", async () => {
    const w = liveWorld();
    await backfilled();
    noteRequest(pageGet("/app/l2-cancellations"));
    // The tab beats with the revision of the list it rendered: the answer speaks of its Safes
    // only for the current content (a list rendered before a change is told to reload instead).
    const item: { key: string; rev: string | null } = { key: watchKeys.vetoes, rev: null };
    /** The tab's beat through the route: what the answer says about the list's Safes. */
    const tabBeat = async () => {
      item.rev = currentRev(watchKeys.vetoes);
      const response = (await beatAction({
        request: new Request("http://localhost/resources/presence", {
          method: "POST",
          headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ tab: "tab-under-test", reason: "interval", items: [item] }),
        }),
        params: {},
        context: {},
      } as never)) as Response;
      const body = (await response.json()) as { checked: Record<string, SafeCheck> };
      return body.checked[watchKeys.vetoes];
    };
    let check = await tabBeat();
    for (let i = 0; i < 30 && !check?.checkedAt; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      check = await tabBeat();
    }
    // The Guardians' Safes, read once each, then every 5 minutes (the list cadence).
    expect(check).toMatchObject({ state: "watching", cadenceMs: 300_000 });
    const first = Date.parse(check?.checkedAt as string);
    const from = mark(w);
    for (let i = 0; i < 33; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      check = await tabBeat();
    }
    const cost = since(w, from);
    // One small change check each (a listing only for a Safe whose newest message the world's
    // equal timestamps make ambiguous).
    expect(cost.checks).toBe(G_MEMBERS.length);
    expect(cost.listings).toBeLessThanOrEqual(1);
    // Copies read together are checked again spread over one cadence (safe/store.ts checkQueue):
    // the oldest one is now one checked since, at least a cadence / count later.
    expect(Date.parse(check?.checkedAt as string) - first).toBeGreaterThanOrEqual(
      300_000 / G_MEMBERS.length - 1_000
    );
    expect(Date.parse(check?.nextAt as string) - Date.now()).toBeLessThanOrEqual(300_000);
    // Nobody looks any more: the answer for a list nobody shows is not given.
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    await vi.advanceTimersByTimeAsync(40_000);
  });
});

describe("on a dev node (anvil): no chain follower, but Safe still reaches an open page", () => {
  it("the watcher asks about the open set's members while the page is on screen, and a new signature makes the page reload", async () => {
    const w = liveWorld({ clientVersion: "anvil/v1.0.0" });
    const params = openSet();
    noteRequest(pageGet(`/app/proposals/${ID}`));
    watchSignatureSet(params);
    const first = await settle(verifyPageSignatureSet(params));
    const item = first.watch as { key: string; rev: string };
    expect(item.rev).not.toBeNull();
    // The tab's beats (the route wakes the engine's side at each).
    const tabBeat = () => {
      beat([item]);
      wakeSync();
    };
    tabBeat();
    expect(syncEngineStatus()).toMatchObject({ active: false });
    // A member signs in Safe; within its minute (the three spread 20 s apart) the watcher sees
    // it, and the page is told.
    w.signInSafe(SC_MEMBERS[2] as Address, params.typedData, ecdsa(941));
    for (let i = 0; i < 13 && compareRevs([item]).changed.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      tabBeat();
    }
    expect(compareRevs([item]).changed).toEqual([item.key]);
    // The reload (at 'latest', as on any dev node) shows it, with a current revision.
    const after = await settle(verifyPageSignatureSet(params));
    expect(after.members[2]?.status).toBe("valid");
    expect(compareRevs([after.watch as { key: string; rev: string }])).toEqual({
      changed: [],
      unknown: [],
    });
    // The member now valid is no longer watched (nor said to be in the set's check); the others
    // still are.
    const watched = watchedSetMembers().map((m) => m.toLowerCase());
    expect(watched).not.toContain((SC_MEMBERS[2] as string).toLowerCase());
    expect(watched).toContain((SC_MEMBERS[0] as string).toLowerCase());
    // Nobody uses the app any more: nothing more is asked.
    presence().beat({ tab: "tab-under-test", reason: "leave", items: [] });
    await vi.advanceTimersByTimeAsync(40_000);
    const from = w.safeRequests.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(w.safeRequests.length).toBe(from);
  });
});
