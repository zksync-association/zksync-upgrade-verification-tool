import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { resetRpcClients, servedHeadNow } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { SAFE_LISTING_MAX_AGE_MS } from "@/.server/safe/store";
import { resetContent } from "@/.server/sync/content-engine";
import { stopSync } from "@/.server/sync/engine";
import {
  PAGE_COPY_MS,
  heldSet,
  lastShownSize,
  resetLastShown,
  rereadsSafe,
} from "@/.server/sync/last-shown";
import { resetPresence } from "@/.server/sync/presence";
import { loader as emergencyPage } from "@/routes/app/emergency/$id/_route";
import { loader as upgradePage } from "@/routes/app/proposals/$id/_route";
import { emergencyExecution } from "@/common/execution";
import type { UpgradeProposal } from "@/common/proposal";
import { type Hex, numberToHex, pad, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PINS, L1 } from "../support/fake-l1";
import { HEAD, NOW, SLOT_MS, backfilled, liveWorld, settle } from "../support/live-world";

// After a pause both upgrade pages' first flush carries the sets last shown (with how each was approved),
// each labelled as of its block, nothing to sign or send from it; and no set whose Safe copies the
// current answer keeps (an executed upgrade's) is said to have them refreshed.

type Loader = (args: {
  request: Request;
  params: Record<string, string>;
  context: Record<string, unknown>;
}) => unknown;

function open(loader: Loader, path: string, params: Record<string, string> = {}) {
  const result = loader({ request: new Request(`http://localhost${path}`), params, context: {} });
  return (result as { data: Record<string, Promise<unknown> | undefined> }).data;
}

/** What `promise` resolves to without the fake clock moving (without any upstream read). */
async function atOnce(promise: Promise<unknown> | undefined): Promise<unknown> {
  expect(promise).toBeInstanceOf(Promise);
  let value: unknown = "not in at once";
  void (promise as Promise<unknown>).then((v) => {
    value = v;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return value;
}

/** A pause of `blocks` blocks: no head in memory, nothing read (no page was open). */
async function pause(w: ReturnType<typeof liveWorld>, blocks = 3) {
  for (let i = 0; i < blocks; i++) {
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    w.nextBlock();
  }
  expect(servedHeadNow()).toBeNull();
}

/** Every deferred value of a page load, settled (what it keeps is kept by then). */
async function load(data: Record<string, Promise<unknown> | undefined>) {
  await settle(Promise.allSettled(Object.values(data).filter(Boolean)));
  await settle(Promise.resolve());
}

const PROPOSAL: UpgradeProposal = {
  calls: [{ target: `0x${"0e".repeat(20)}`, value: "0", data: "0x" }],
  executor: L1.emergencyUpgradeBoard,
  salt: pad(numberToHex(0xe0e0), { size: 32 }) as Hex,
};
const transaction = (hash: Hex) => ({
  hash,
  from: zeroAddress,
  to: L1.emergencyUpgradeBoard,
  input: emergencyExecution(L1.emergencyUpgradeBoard, PROPOSAL, [], [], "0x01").data,
  value: "0x0",
  nonce: "0x0",
  gas: "0x0",
  type: "0x0",
  gasPrice: "0x0",
});

type HeldSet = {
  key: string;
  state: { status: string };
  execution: unknown;
  set: Record<string, unknown> & { members: { status: string }[] };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
  resetPresence({ keepWarmMs: 30_000 });
  resetVerdicts();
  resetContent();
  resetLastShown();
  overrideCodePinsForTests(FAKE_PINS);
});

afterEach(() => {
  stopSync();
  overrideCodePinsForTests(undefined);
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the upgrade page after a pause", () => {
  it("sends its sets as last shown at once, labelled, with the upgrade", async () => {
    // (Any transaction, for the recorded approvals' lookups: none decodes as an approval.)
    const w = liveWorld({ transaction });
    await backfilled();
    const id = w.upgradeId;
    const before = open(upgradePage, `/app/proposals/${id}`, { id });
    expect(await settle(before.heldApprovals as Promise<unknown>)).toBeNull();
    const shownSets = (await settle(before.freshSets as Promise<unknown>)) as HeldSet[] | null;
    const firstSets = (await settle(before.sets as Promise<unknown>)) as HeldSet[];
    const current = shownSets ?? firstSets;
    await load(before);
    expect(current.map((s) => s.set.stale)).toEqual([false, false, false]);

    // Longer than the page rule: the copies are older than 60 s.
    await pause(w, 6);
    const safeBefore = w.safeRequests.length;
    const after = open(upgradePage, `/app/proposals/${id}`, { id });
    const detail = (await atOnce(after.detail)) as { asOf: { block: string } };
    const held = (await atOnce(after.heldApprovals)) as {
      sets: HeldSet[];
      asOf: { block: string };
    };
    // The same page load as the upgrade shown with them (the page checks it), at its block.
    expect(held.asOf.block).toBe(HEAD.toString());
    expect(detail.asOf.block).toBe(held.asOf.block);
    // How each set was approved is in its card: no separate list of recorded approvals.
    expect(held).not.toHaveProperty("evidence");
    expect(held.sets.map((s) => s.state.status)).toEqual(current.map((s) => s.state.status));
    expect(held.sets.map((s) => s.key)).toEqual(current.map((s) => s.key));
    for (const [i, s] of held.sets.entries()) {
      const shown = current[i] as HeldSet;
      expect(s.set.members.map((m) => m.status)).toEqual(shown.set.members.map((m) => m.status));
      expect(s.set).toMatchObject({
        stale: true,
        verifiedAtBlock: HEAD.toString(),
        reverifyingAt: null,
        safeCheck: null,
        // Executed: the current answer keeps these copies (never "refreshing").
        rereadsSafe: false,
      });
      expect(s.set.watch).toBeUndefined();
      // Nothing to send from it.
      expect(s.execution).toBeNull();
      expect(s.state.status).not.toBe("open");
    }
    const fresh = (await settle(after.freshSets as Promise<unknown>)) as HeldSet[] | null;
    const first = (await settle(after.sets as Promise<unknown>)) as HeldSet[];
    for (const s of fresh ?? first) expect(s.set.verifiedAtBlock).toBe((HEAD + 6n).toString());
    // A stale first answer of an executed upgrade's sets: its copies are kept, not refreshed (and
    // indeed Safe is not asked).
    expect(first.filter((s) => s.set.stale)).toHaveLength(3);
    for (const s of first) expect(s.set.rereadsSafe).toBe(false);
    expect(w.safeRequests.length).toBe(safeBefore);
    await load(after);
  });

  it("a page with a signature from its URL keeps nothing of its sets and is sent none", async () => {
    const w = liveWorld();
    await backfilled();
    const id = w.upgradeId;
    const sig = `?sig=${w.sets[0]?.members[0]}:0x${"11".repeat(65)}`;
    const before = open(upgradePage, `/app/proposals/${id}${sig}`, { id });
    await load(before);
    // The upgrade itself only (the overview section).
    expect(lastShownSize()).toBe(1);

    await pause(w);
    const after = open(upgradePage, `/app/proposals/${id}${sig}`, { id });
    expect(await atOnce(after.heldApprovals)).toBeNull();
    // A page without the signature after the same pause has none kept either.
    expect(
      await atOnce(open(upgradePage, `/app/proposals/${id}`, { id }).heldApprovals)
    ).toBeNull();
    await load(after);
  });
});

describe("the emergency upgrade page after a pause", () => {
  it("sends its signatures as last shown at once, labelled, with the upgrade", async () => {
    const w = liveWorld({ transaction });
    await backfilled();
    const id = w.emergencyId;
    const before = open(emergencyPage, `/app/emergency/${id}`, { id });
    expect(await settle(before.lastShownRoles as Promise<unknown>)).toBeNull();
    const shownFresh = (await settle(before.verifiedFresh as Promise<unknown>)) as {
      roles: HeldSet[];
    } | null;
    const shown = shownFresh ?? ((await settle(before.verified as Promise<unknown>)) as never);
    await load(before);

    await pause(w, 6);
    const safeBefore = w.safeRequests.length;
    const after = open(emergencyPage, `/app/emergency/${id}`, { id });
    const upgrade = (await atOnce(after.lastShown)) as { asOf: { block: string } };
    const held = (await atOnce(after.lastShownRoles)) as {
      roles: HeldSet[];
      executed: boolean;
      asOf: { block: string };
    };
    expect(held.asOf.block).toBe(upgrade.asOf.block);
    expect(held.executed).toBe(true);
    expect(held.roles.map((r) => r.key)).toEqual(
      (shown as { roles: HeldSet[] }).roles.map((r) => r.key)
    );
    for (const r of held.roles) {
      expect(r.set).toMatchObject({
        stale: true,
        verifiedAtBlock: HEAD.toString(),
        reverifyingAt: null,
        safeCheck: null,
        rereadsSafe: false,
      });
      expect(r.set.watch).toBeUndefined();
    }
    await load(after);
    expect(w.safeRequests.length).toBe(safeBefore);
  });
});

describe("whether a set's copies are refreshed", () => {
  const safeMember = (status: string, isContract = true) => ({
    status,
    safe: { isContract },
  });
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("only for a set that can still be signed, with a Safe not valid yet and copies past the rule", () => {
    const old = {
      members: [safeMember("valid"), safeMember("missing")],
      safeFetchedAt: at(90_000),
    };
    expect(rereadsSafe(old as never, true, NOW)).toBe(true);
    // Its copies within the page rule: used as they are.
    expect(rereadsSafe({ ...old, safeFetchedAt: at(30_000) } as never, true, NOW)).toBe(false);
    // Copies never read (Safe failed): read again.
    expect(rereadsSafe({ ...old, safeFetchedAt: null } as never, true, NOW)).toBe(true);
    // Done or closed: the page keeps any copy it holds.
    expect(rereadsSafe(old as never, false, NOW)).toBe(false);
    // Every Safe valid, or the one not valid is no Safe: nothing to read.
    const valid = { members: [safeMember("valid"), safeMember("missing", false)] };
    expect(rereadsSafe({ ...old, ...valid } as never, true, NOW)).toBe(false);
  });

  it("uses the store's page rule (it cannot load the store itself)", () => {
    expect(PAGE_COPY_MS).toBe(SAFE_LISTING_MAX_AGE_MS);
  });

  it("labels a kept set as a held first answer: stale, unfollowed, without Safe checks", () => {
    const set = {
      members: [safeMember("missing")],
      safeFetchedAt: at(600_000),
      stale: false,
      reverifyingAt: "1",
      watch: { key: "set:x", rev: "r" },
      safeCheck: { state: "watching" },
      verifiedAtBlock: "100",
    };
    vi.setSystemTime(NOW);
    expect(heldSet(set as never, true)).toMatchObject({
      stale: true,
      reverifyingAt: null,
      watch: undefined,
      safeCheck: null,
      verifiedAtBlock: "100",
      rereadsSafe: true,
    });
    expect(heldSet(set as never, false)).toMatchObject({ rereadsSafe: false });
  });
});
