import { clearCache, peek, remainingMs } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { type FreezeParams, loadFreezeRequest } from "@/.server/flows/freeze";
import { type VetoParams, vetoState } from "@/.server/flows/l2-veto";
import { getStandardUpgradeCore, listStandardUpgrades } from "@/.server/flows/standard";
import {
  GOVERNANCE_KEY,
  governance,
  governanceReadKind,
  governanceSplitApplies,
  pageGovernanceKey,
  readGovernance,
} from "@/.server/governance";
import { pageGovernance } from "@/.server/page-governance";
import { latestBlock, resetRpcClients } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { holdLastRunListings, listingsToKeep } from "@/.server/safe/store";
import {
  type SignatureSetParams,
  firstSignatureSet,
  precomputeSignatureSets,
  signatureSetsStatus,
  verifyPageSignatureSet,
  verifySignatureSet,
  watchSignatureSet,
} from "@/.server/signatures";
import { appStatus } from "@/.server/status";
import { noteRequest, stopSync, syncEngineStatus } from "@/.server/sync/engine";
import { presence, resetPresence, watchKeys } from "@/.server/sync/presence";
import { snapshotStatus } from "@/.server/sync/snapshot";
import { currentUpgradeStatus, upgradeStatusKey } from "@/.server/upgrade-status";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Hex, getAddress, numberToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockHash } from "../support/fake-chain";
import { FakeRpcError } from "../support/fake-jsonrpc";
import { FAKE_PINS, L1, SC_MEMBERS } from "../support/fake-l1";
import {
  HEAD_TIME,
  type LiveWorld,
  NOW,
  SLOT_MS,
  backfilled,
  liveEngine,
  liveWorld,
  settle,
  until,
} from "../support/live-world";

// What is on screen is read again at every served head, in as few combined calls as possible. Per
// block with pages on screen: the head polls, one eth_getLogs for the index tail and ONE aggregate3
// for the snapshot and the verdicts; no governance round, no direct verdict call, no Safe request.

const VERDICTS = new Set(["checkSignatures", "isValidSignature", "signedMessages"]);
const GOVERNANCE_GETTERS = new Set([
  "securityCouncil",
  "guardians",
  "emergencyUpgradeBoard",
  "protocolFrozenUntil",
  "lastFreezeStatusInUpgradeCycle",
  "members",
  "eip712Domain",
  "EIP1271_THRESHOLD",
  "softFreezeThreshold",
  "nonce",
]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
  resetPresence({ keepWarmMs: 600_000 });
  resetVerdicts();
  overrideCodePinsForTests(FAKE_PINS);
});

// The engines a test started, stopped after it, and its loops told to stop (`ended`).
const engines: { stop(): void }[] = [];
let testRun = 0;
/** For a test's loop: whether the test it belongs to has ended (timed out). */
const endedSince = (run: number) => () => run !== testRun;

afterEach(() => {
  testRun++;
  for (const engine of engines.splice(0)) engine.stop();
  stopSync();
  overrideCodePinsForTests(undefined);
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A visible tab shows both detail pages: their sets and ids. */
function showPages(w: LiveWorld) {
  presence().beat({
    tab: "tab-under-test",
    reason: "interval",
    items: [
      ...w.sets.map((set) => watchSignatureSet(set)),
      { key: watchKeys.upgrade(w.upgradeId), rev: null },
      { key: watchKeys.emergency(w.emergencyId), rev: null },
    ],
  });
}

/** What one block cost upstream, by kind. */
function costOf(w: LiveWorld, from: { posts: number; calls: number; safe: number }, head: bigint) {
  const entries = w.fake.posts.slice(from.posts).flatMap((p) => p.calls);
  const calls = w.fake.calls.slice(from.calls);
  const multicall = (c: { method: string; params: unknown[] }) =>
    c.method === "eth_call" &&
    String((c.params[0] as { to?: string }).to).toLowerCase() === L1.multicall3.toLowerCase();
  return {
    polls: entries.filter((c) => c.method === "eth_getBlockByNumber" && c.params[0] === "latest")
      .length,
    logs: entries.filter((c) => c.method === "eth_getLogs").length,
    aggregatesAtHead: entries.filter((c) => multicall(c) && c.params[1] === numberToHex(head))
      .length,
    aggregatesElsewhere: entries.filter((c) => multicall(c) && c.params[1] !== numberToHex(head))
      .length,
    directVerdicts: calls.filter((c) => !c.viaMulticall && VERDICTS.has(c.functionName)).length,
    governance:
      calls.filter((c) => !c.viaMulticall && GOVERNANCE_GETTERS.has(c.functionName)).length +
      entries.filter(
        (c) =>
          c.method === "eth_getCode" &&
          String(c.params[0]).toLowerCase() === L1.upgradeHandler.toLowerCase()
      ).length,
    getCode: entries.filter((c) => c.method === "eth_getCode").length,
    other: entries.filter(
      (c) => !["eth_getBlockByNumber", "eth_getLogs", "eth_call", "eth_getCode"].includes(c.method)
    ).length,
    safe: w.safeRequests.length - from.safe,
  };
}

const mark = (w: LiveWorld) => ({
  posts: w.fake.posts.length,
  calls: w.fake.calls.length,
  safe: w.safeRequests.length,
});

/** The world after a page load of both detail pages, the engine following (a few blocks in). */
async function following(w: LiveWorld, warmBlocks = 3) {
  await backfilled();
  // The boot warm-up's full governance read, and its code check a moment later.
  await settle(governance());
  await vi.advanceTimersByTimeAsync(1_500);
  // The pages' first loads: every set verified as JSON would (each member Safe read once).
  for (const set of w.sets) await settle(verifySignatureSet(set));
  showPages(w);
  const engine = liveEngine();
  engines.push(engine);
  engine.resume();
  await until(() => engine.status().ticks >= 1);
  for (let i = 0; i < warmBlocks; i++) {
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    showPages(w);
  }
  return engine;
}

describe("C-1: two executed detail pages on screen, 200 quiet blocks", () => {
  it("per block: at most 4 head polls, one eth_getLogs, one aggregate3 at the head, no direct verdict, no governance round, no Safe", async () => {
    const w = liveWorld();
    const ended = endedSince(testRun);
    const engine = await following(w);
    const blocks: ReturnType<typeof costOf>[] = [];
    for (let b = 0; b < 200; b++) {
      if (ended()) return;
      const from = mark(w);
      const head = w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
      showPages(w);
      blocks.push(costOf(w, from, head));
    }
    expect(engine.status().ticks).toBeGreaterThanOrEqual(203);
    expect(Math.max(...blocks.map((b) => b.polls))).toBeLessThanOrEqual(4);
    expect(blocks.every((b) => b.logs === 1)).toBe(true);
    // The snapshot and every set's verdicts share one aggregate3 at the head (two at most).
    expect(Math.max(...blocks.map((b) => b.aggregatesAtHead))).toBeLessThanOrEqual(2);
    expect(blocks.filter((b) => b.aggregatesAtHead === 1).length).toBeGreaterThanOrEqual(195);
    // Once per id, its terminal state confirmed at the finality boundary (then carried as final).
    expect(blocks.reduce((sum, b) => sum + b.aggregatesElsewhere, 0)).toBeLessThanOrEqual(2);
    expect(blocks.reduce((sum, b) => sum + b.directVerdicts, 0)).toBe(0);
    expect(blocks.reduce((sum, b) => sum + b.governance, 0)).toBe(0);
    expect(blocks.reduce((sum, b) => sum + b.getCode, 0)).toBe(0);
    expect(blocks.reduce((sum, b) => sum + b.other, 0)).toBe(0);
    expect(blocks.reduce((sum, b) => sum + b.safe, 0)).toBe(0);
    const average = (key: keyof ReturnType<typeof costOf>) =>
      blocks.reduce((sum, b) => sum + b[key], 0) / blocks.length;
    // About 5 requests a block: ~3 polls, the tail, the aggregate.
    expect(average("polls") + average("logs") + average("aggregatesAtHead")).toBeLessThan(5.3);
    // Every set on screen was verified at every head, its positives from the aggregate.
    expect(signatureSetsStatus()).toMatchObject({
      onScreen: 6,
      perBlock: { reasked: 0, direct: 0 },
      lastRecompute: { sets: 6, failed: 0 },
    });
    expect(signatureSetsStatus().perBlock?.fast).toBeGreaterThan(0);
    expect(snapshotStatus()).toMatchObject({ governance: "split", unknown: [] });
    // 200 blocks of the live engine: about 4 s on its own, longer under load.
  }, 30_000);
});

/** Runs the engine one block on (a beat keeps the pages on screen), and returns the new head. */
async function block(w: LiveWorld): Promise<bigint> {
  const head = w.nextBlock();
  await vi.advanceTimersByTimeAsync(SLOT_MS);
  showPages(w);
  return head;
}

/** Answers `value` for `functionName` at blocks from `from` on (else the fake's table). */
const fromBlock =
  (functionName: string, from: () => bigint, value: unknown) =>
  (call: { functionName: string; block: string }) =>
    call.functionName === functionName && call.block !== "latest" && BigInt(call.block) >= from()
      ? value
      : undefined;

describe("governance at each head, for pages", () => {
  it("is the constructor-only part kept and the values that change read at the head: equal to a full read there, from memory", async () => {
    const w = liveWorld();
    await following(w);
    const head = await block(w);
    const from = mark(w);
    const page = await settle(pageGovernance());
    expect(w.fake.posts.length).toBe(from.posts);
    expect(page.latestBlock.number).toBe(head.toString());
    expect(governanceReadKind(page)).toBe("split");
    // The same answer as a full read at that block.
    const full = await settle(readGovernance(await latestBlock()));
    expect(page).toEqual(full);
  });

  it("JSON keeps its own full read (at most 30 s old) and never reads the page's", async () => {
    const w = liveWorld();
    await following(w);
    const jsonBefore = await settle(governance());
    const head = await block(w);
    const page = await settle(pageGovernance());
    const json = await settle(governance());
    expect(page.latestBlock.number).toBe(head.toString());
    expect(json).not.toBe(page);
    // Within its 30 s the JSON answer is its own read, not the page's at the new head.
    expect(remainingMs(GOVERNANCE_KEY)).not.toBeNull();
    expect(json.latestBlock.number).not.toBe(head.toString());
    expect(json).toBe(jsonBefore);
    // The engine never writes the JSON entry: once its 30 s are up, JSON reads again itself.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(remainingMs(GOVERNANCE_KEY)).toBeNull();
  });

  it("S-3: setSoftFreezeThreshold (no log anywhere) changes the threshold, the SoftFreeze set and the freeze state at the first head after it", async () => {
    let change = Number.POSITIVE_INFINITY as unknown as bigint;
    const at = () => change;
    const w = liveWorld({
      answer: (call) =>
        fromBlock("softFreezeThreshold", at, 2n)(call) ??
        fromBlock("softFreezeThresholdSettingNonce", at, 1n)(call),
    });
    await following(w);
    const SET: FreezeParams = {
      action: "SetSoftFreezeThreshold",
      nonce: "0",
      validUntil: String(Math.floor(NOW / 1000) + 86_400),
      threshold: "2",
    };
    const SOFT: FreezeParams = { action: "SoftFreeze", nonce: "0", validUntil: SET.validUntil };
    const before = await settle(loadFreezeRequest(SOFT, { freshness: "page" }).fresh);
    expect(before.set.threshold).toBe(1);
    expect((await settle(loadFreezeRequest(SET, { freshness: "page" }).fresh)).state.status).toBe(
      "open"
    );
    change = w.head() + 1n;
    await block(w);
    // Read at the new head by the engine: the page's governance has it from memory.
    const from = mark(w);
    const gov = await settle(pageGovernance());
    expect(w.fake.posts.length).toBe(from.posts);
    expect(gov.securityCouncil.thresholds.softFreeze).toBe(2);
    expect(gov.securityCouncil.nonces.setSoftFreezeThreshold).toBe("1");
    const soft = await settle(loadFreezeRequest(SOFT, { freshness: "page" }).fresh);
    expect(soft.set.threshold).toBe(2);
    expect(soft.set.watch?.key).not.toBe(before.set.watch?.key);
    expect((await settle(loadFreezeRequest(SET, { freshness: "page" }).fresh)).state).toMatchObject(
      { status: "done" }
    );
  });

  it("S-4: a Guardians veto (its nonce moves, no log at the Guardians) is seen at the first head after it", async () => {
    let change = Number.POSITIVE_INFINITY as unknown as bigint;
    const w = liveWorld({ answer: fromBlock("nonce", () => change, 1n) });
    await following(w);
    const params: VetoParams = {
      l2ProposalId: "1",
      l2GovernorAddress: L1.guardians,
      l2GasLimit: "1",
      l2GasPerPubdataByteLimit: "800",
      refundRecipient: L1.guardians,
      txMintValue: "0",
      nonce: "0",
    };
    expect(vetoState(await settle(pageGovernance()), params, null)).toEqual({ status: "open" });
    change = w.head() + 1n;
    await block(w);
    const gov = await settle(pageGovernance());
    expect(gov.guardians.nonce).toBe("1");
    expect(vetoState(gov, params, null)).toMatchObject({ status: "done" });
  });

  it("another Security Council named by the handler: a full read at the head, the new contract from then on", async () => {
    const NEW_SC = getAddress("0x5c00000000000000000000000000000000000001");
    let change = Number.POSITIVE_INFINITY as unknown as bigint;
    const w = liveWorld({
      answer: fromBlock("securityCouncil", () => change, NEW_SC),
      aliases: new Map([[NEW_SC, L1.securityCouncil]]),
    });
    await following(w);
    change = w.head() + 1n;
    const head = await block(w);
    const gov = await settle(pageGovernance());
    expect(gov.securityCouncil.address).toBe(NEW_SC);
    expect(gov.latestBlock.number).toBe(head.toString());
    // The contracts the read found are checked against the pins (once), then the split applies.
    await vi.advanceTimersByTimeAsync(1_500);
    await block(w);
    const next = await settle(pageGovernance());
    expect(next.securityCouncil.address).toBe(NEW_SC);
    expect(governanceReadKind(next)).toBe("split");
  });

  it("a pin check that could not read a code hash (an RPC error outlasting the retries) is made again when next needed: the split applies once the RPC answers", async () => {
    let failing = true;
    const w = liveWorld({
      code: (address, block) =>
        failing && address === L1.securityCouncil && block === "latest"
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    await backfilled();
    await settle(governance());
    showPages(w);
    expect(await settle(governanceSplitApplies())).toBe(false);
    // The check runs a moment later and fails (the lane's retries included).
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await settle(governanceSplitApplies())).toBe(false);
    failing = false;
    showPages(w);
    await vi.advanceTimersByTimeAsync(1_500);
    // Not "not pinned" for good: checked again, and now it holds.
    expect(await settle(governanceSplitApplies())).toBe(true);
  });

  it("the one-time pin check reads nothing when nobody uses the app by its moment; the next need starts it again", async () => {
    const w = liveWorld();
    await backfilled();
    await settle(governance());
    const codeReads = () => w.fake.requests("eth_getCode").length;
    const before = codeReads();
    expect(await settle(governanceSplitApplies())).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(codeReads()).toBe(before);
    showPages(w);
    expect(await settle(governanceSplitApplies())).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await settle(governanceSplitApplies())).toBe(true);
    // The Security Council's, the Guardians' and the Emergency Upgrade Board's code, once.
    expect(codeReads()).toBe(before + 3);
  });

  it("code that is not the pinned code: pages read governance as JSON does, and the engine keeps it fresh as before", async () => {
    overrideCodePinsForTests({ ...FAKE_PINS, securityCouncil: `0x${"ee".repeat(32)}` });
    const w = liveWorld();
    await following(w);
    const from = mark(w);
    const head = await block(w);
    // The engine read governance in full at the new head (rounds), as without the split.
    const cost = costOf(w, from, head);
    expect(cost.governance).toBeGreaterThan(0);
    expect(snapshotStatus()).toMatchObject({ governance: "as-json" });
    const gov = await settle(pageGovernance());
    expect(gov).toBe(await settle(governance()));
    expect(gov.latestBlock.number).toBe(head.toString());
  });
});

describe("the snapshot: read at each head, nothing carried", () => {
  it("S-5: an upgrade's state moves with time: the first head past the boundary shows the new state and open-ness", async () => {
    let change = Number.POSITIVE_INFINITY as unknown as bigint;
    const w = liveWorld({
      answer: fromBlock("upgradeState", () => change, UPGRADE_STATES.Waiting),
    });
    // An upgrade in its legal veto period (not over: read at every head).
    const id = w.upgradeId;
    w.upgrades.set(id.toLowerCase(), {
      state: UPGRADE_STATES.LegalVetoPeriod,
      status: [Number(HEAD_TIME) - 86_400, 0, false, false, false],
    });
    await following(w);
    const before = await settle(getStandardUpgradeCore(id, { freshness: "page" }));
    expect(before.state).toBe(UPGRADE_STATES.LegalVetoPeriod);
    change = w.head() + 1n;
    const head = await block(w);
    const from = mark(w);
    expect((await settle(currentUpgradeStatus(id))).state).toBe(UPGRADE_STATES.Waiting);
    expect(w.fake.posts.length).toBe(from.posts);
    const after = await settle(getStandardUpgradeCore(id, { freshness: "page" }));
    expect(after.state).toBe(UPGRADE_STATES.Waiting);
    expect(after.governance.latestBlock.number).toBe(head.toString());
    expect(snapshotStatus()?.ids.read).toBeGreaterThanOrEqual(1);
  });

  it("S-5: a freeze request's validUntil: closed at the first head whose timestamp reaches it", async () => {
    const w = liveWorld();
    await following(w);
    // Just after the current head's timestamp: the next head (12 s later) is past it.
    const validUntil = String(Number(w.fake.chain.options.head?.timestamp ?? 0n) + 1);
    const params: FreezeParams = { action: "SoftFreeze", nonce: "0", validUntil };
    expect(
      (await settle(loadFreezeRequest(params, { freshness: "page" }).fresh)).state.status
    ).toBe("open");
    await block(w);
    const after = await settle(loadFreezeRequest(params, { freshness: "page" }).fresh);
    expect(after.state).toMatchObject({ status: "closed" });
  });

  it("S-15: a sub-call that fails leaves that value unknown at the head: nothing stored, the request reads it itself, never a downgrade", async () => {
    let failAt: string | null = null;
    let failures = 0;
    const w = liveWorld({
      inject: (call) => {
        if (!call.viaMulticall || call.block !== failAt || call.functionName !== "upgradeState")
          return undefined;
        // Only the engine's snapshot (the first aggregate at that block).
        if (failures++ > 0) return undefined;
        return new FakeRpcError(-32603, "internal error");
      },
    });
    const id = w.upgradeId;
    w.upgrades.set(id.toLowerCase(), {
      state: UPGRADE_STATES.Waiting,
      status: [Number(HEAD_TIME) - 86_400, 0, false, false, false],
    });
    await following(w);
    failAt = numberToHex(w.head() + 1n);
    const head = await block(w);
    expect(snapshotStatus()).toMatchObject({ block: head.toString() });
    expect(snapshotStatus()?.unknown).toContain(id);
    expect(peek(upgradeStatusKey(1, id, await latestBlock()))).toBeNull();
    // The request reads it at the head itself: the true state.
    expect((await settle(currentUpgradeStatus(id))).state).toBe(UPGRADE_STATES.Waiting);
  });

  it("S-17: an upstream error during the recompute keeps nothing: no result at that head, the last one stays as it was", async () => {
    let failAt: string | null = null;
    const w = liveWorld({
      stateAt: (block) =>
        block === failAt ? new FakeRpcError(-32603, "internal error") : undefined,
    });
    await following(w);
    const last = (await settle(verifySignatureSet(w.sets[0] as SignatureSetParams)))
      .verifiedAtBlock;
    failAt = numberToHex(w.head() + 1n);
    await block(w);
    expect(signatureSetsStatus().lastRecompute).toMatchObject({ failed: 6, verified: 0 });
    // A request at that head verifies on its own, and fails (an upstream error, never a verdict).
    await expect(settle(verifySignatureSet(w.sets[0] as SignatureSetParams))).rejects.toThrow();
    // The next head reads again, and the set is what it was.
    failAt = null;
    const head = await block(w);
    const set = await settle(verifySignatureSet(w.sets[0] as SignatureSetParams));
    expect(set.verifiedAtBlock).toBe(head.toString());
    expect(set.verifiedAtBlock).not.toBe(last);
    expect(set.thresholdCheck.status).toBe("met");
  });

  it("S-20: a settings change while the head's aggregate is out: nothing it read is stored", async () => {
    let gateAt: string | null = null;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = liveWorld({
      gate: (call) =>
        call.viaMulticall && call.block === gateAt && call.functionName === "getBlockNumber"
          ? held
          : undefined,
    });
    await following(w);
    const next = w.head() + 1n;
    gateAt = numberToHex(next);
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(3_000);
    const at = w.fake.chain.options.head as { number: bigint; hash: Hex };
    // What a settings change does (settings.ts).
    clearCache();
    resetRpcClients();
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(peek(pageGovernanceKey(at))).toBeNull();
    expect(peek(upgradeStatusKey(1, w.upgradeId, at))).toBeNull();
    expect(snapshotStatus()?.block).not.toBe(next.toString());
  });

  it("S-22: a provider that runs eth_call in the next block's context passes the guard", async () => {
    const w = liveWorld({ guard: "next-block" });
    await following(w);
    for (let i = 0; i < 3; i++) await block(w);
    expect(snapshotStatus()).toMatchObject({
      governance: "split",
      unknown: [],
      guard: { failures: 0 },
    });
    expect(snapshotStatus()?.guard.conventions["next-block"]).toBeGreaterThan(0);
    expect(signatureSetsStatus().perBlock).toMatchObject({ reasked: 0, direct: 0 });
  });

  it("S-22: an answer from another block makes its values unknown at the head: no positive from it, governance read in full there, never a downgrade", async () => {
    let wrong: string | null = null;
    const w = liveWorld({
      guardAt: (block) =>
        block === wrong
          ? { number: BigInt(block) - 1n, lastHash: blockHash(BigInt(block) - 2n) }
          : undefined,
    });
    await following(w);
    wrong = numberToHex(w.head() + 1n);
    const head = await block(w);
    // Governance's values that change were unknown there: it was read in full at the head (by
    // number), so pages at that head still get it, from memory.
    expect(snapshotStatus()).toMatchObject({ block: head.toString(), governance: "full-read" });
    expect(snapshotStatus()?.guard.failures).toBeGreaterThan(0);
    // Every set's verdict there was asked directly instead (no positive from that aggregate).
    expect(signatureSetsStatus().perBlock).toMatchObject({ fast: 0, reasked: 14 });
    wrong = null;
    const from = mark(w);
    const gov = await settle(pageGovernance());
    expect(w.fake.posts.length).toBe(from.posts);
    expect(gov.latestBlock.number).toBe(head.toString());
    expect(gov.securityCouncil.members).toEqual(SC_MEMBERS);
    const set = await settle(verifySignatureSet(w.sets[0] as SignatureSetParams));
    expect(set.thresholdCheck.status).toBe("met");
    // One aggregate answered for another block is one failure, not one per check it carried: the
    // next head's verdicts come from its aggregate again.
    const next = await block(w);
    expect(signatureSetsStatus().lastRecompute?.block).toBe(next.toString());
    expect(signatureSetsStatus().perBlock).toMatchObject({ reasked: 0, direct: 0 });
    expect(signatureSetsStatus().perBlock?.fast).toBeGreaterThan(0);
  });
});

describe("sets verified by the engine from Safe copies older than 60 s", () => {
  /**
   * The engine verifies the six (closed) sets from the copies held, then JSON asks for the
   * council's approval set and emergency set (the same member Safes, the same head).
   */
  async function jsonAfterHeldPrecompute(w: LiveWorld, verified = 6) {
    showPages(w);
    const head = await settle(latestBlock());
    const before = w.safeRequests.length;
    const run = await settle(precomputeSignatureSets(head));
    // From the copies held, whatever their age (never the last run's): no Safe request.
    expect(run).toMatchObject({ sets: 6, verified, skipped: 6 - verified, failed: 0 });
    expect(w.safeRequests.length).toBe(before);
    const approval = await settle(verifySignatureSet(w.sets[0] as SignatureSetParams));
    const emergency = await settle(verifySignatureSet(w.sets[3] as SignatureSetParams));
    return { approval, emergency };
  }

  it("JSON never takes one: it verifies from copies at most 60 s old (copies 10 minutes old held)", async () => {
    const w = liveWorld();
    await backfilled();
    for (const set of w.sets) await settle(verifySignatureSet(set));
    await vi.advanceTimersByTimeAsync(600_000);
    const { approval, emergency } = await jsonAfterHeldPrecompute(w);
    for (const set of [approval, emergency]) {
      expect(Date.now() - Date.parse(set.safeFetchedAt ?? "")).toBeLessThanOrEqual(60_000);
      expect(set.stale).toBe(false);
      expect(set.thresholdCheck.status).toBe("met");
    }
    // A page's result for a set the engine verified that way (one that can no longer be signed):
    // current at the head, from the copies held, labelled with their age; no Safe request.
    const before = w.safeRequests.length;
    const page = await settle(verifyPageSignatureSet(w.sets[4] as SignatureSetParams));
    expect(page.stale).toBe(false);
    expect(Date.now() - Date.parse(page.safeFetchedAt ?? "")).toBeGreaterThan(60_000);
    expect(w.safeRequests.length).toBe(before);
    // Its first answer is that result itself.
    const first = await settle(
      firstSignatureSet(w.sets[4] as SignatureSetParams, Promise.resolve(page))
    );
    expect(first).toBe(page);
  });

  it("…nor a kept result whose copies turned 60 s old since, its listings re-read unchanged by another set", async () => {
    const w = liveWorld();
    await backfilled();
    const approval = w.sets[0] as SignatureSetParams;
    const emergency = w.sets[3] as SignatureSetParams;
    // The council's member Safes read once; 50 s later the emergency set (the same Safes) is
    // verified from those copies, still within 60 s, and kept.
    await settle(verifySignatureSet(approval));
    await vi.advanceTimersByTimeAsync(50_000);
    await settle(verifySignatureSet(emergency));
    // 15 s later the approval set reads the Safes again (their copies are 65 s old): unchanged.
    await vi.advanceTimersByTimeAsync(15_000);
    const before = w.safeRequests.length;
    await settle(verifySignatureSet(approval));
    expect(w.safeRequests.length).toBeGreaterThan(before);
    // The emergency set kept at this head used copies that are now 65 s old: not the answer.
    const set = await settle(verifySignatureSet(emergency));
    expect(Date.now() - Date.parse(set.safeFetchedAt ?? "")).toBeLessThanOrEqual(60_000);
    expect(set.thresholdCheck.status).toBe("met");
  });

  it("…nor one verified from the last run's copies (kept on disk, two days old)", async () => {
    const w = liveWorld();
    for (const set of w.sets) await settle(verifySignatureSet(set));
    const kept = listingsToKeep();
    await vi.advanceTimersByTimeAsync(600_000);
    // A new process: nothing in memory but the last run's copies.
    clearCache();
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    expect(
      holdLastRunListings(kept.map(({ version: _, ...l }) => ({ ...l, fetchedAt: twoDaysAgo })))
    ).toBeGreaterThan(0);
    await backfilled();
    // The engine verifies none of them from the last run's copies: pages read them first.
    const { approval, emergency } = await jsonAfterHeldPrecompute(w, 0);
    for (const set of [approval, emergency]) {
      expect(Date.now() - Date.parse(set.safeFetchedAt ?? "")).toBeLessThanOrEqual(60_000);
      expect(set.stale).toBe(false);
      expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    }
  });
});

describe("C-5: a JSON-only session (AGENTS.md)", () => {
  it("never starts the follower: the requests are the on-demand reads, and nothing after them", async () => {
    const w = liveWorld();
    await backfilled();
    for (const path of ["/api/status", "/api/upgrades", `/api/upgrades/${w.upgradeId}`])
      noteRequest({ method: "GET", path, header: () => null });
    await settle(appStatus());
    await settle(listStandardUpgrades({ allHistory: false }));
    await settle(getStandardUpgradeCore(w.upgradeId));
    expect(syncEngineStatus()).toMatchObject({ active: false, polls: 0, ticks: 0 });
    expect(presence().inUse()).toBe(false);
    const from = mark(w);
    for (let i = 0; i < 50; i++) {
      w.nextBlock();
      await vi.advanceTimersByTimeAsync(SLOT_MS);
    }
    expect(w.fake.posts.length - from.posts).toBe(0);
    expect(w.safeRequests.length - from.safe).toBe(0);
    expect(syncEngineStatus()).toMatchObject({ active: false, polls: 0 });
  });
});
