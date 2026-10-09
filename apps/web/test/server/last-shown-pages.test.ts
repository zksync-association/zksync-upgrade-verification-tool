import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { resetRpcClients, servedHeadNow } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { resetContent } from "@/.server/sync/content-engine";
import { stopSync } from "@/.server/sync/engine";
import { resetLastShown } from "@/.server/sync/last-shown";
import { resetPresence } from "@/.server/sync/presence";
import { loader as upgradesJson } from "@/routes/api+/upgrades._index";
import { loader as home } from "@/routes/_index/_route";
import { loader as emergencyPage } from "@/routes/app/emergency/$id/_route";
import { loader as emergencyList } from "@/routes/app/emergency/_index/_route";
import { loader as vetoList } from "@/routes/app/l2-cancellations/_index/_route";
import { loader as upgradePage } from "@/routes/app/proposals/$id/_route";
import { loader as upgradeList } from "@/routes/app/proposals/_index/_route";
import { emergencyExecution } from "@/common/execution";
import type { UpgradeProposal } from "@/common/proposal";
import { type Hex, numberToHex, pad, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PINS, L1 } from "../support/fake-l1";
import { HEAD, NOW, SLOT_MS, backfilled, liveWorld, settle } from "../support/live-world";

// After a pause each page's main data as last shown is there at once, labelled with its block, and
// the current data replaces it in the same response. JSON: only what it reads at the newest block.

type Loader = (args: {
  request: Request;
  params: Record<string, string>;
  context: Record<string, unknown>;
}) => unknown;

type Key =
  | "detail"
  | "freshDetail"
  | "sets"
  | "lastShown"
  | "executed"
  | "verifiedFresh"
  | "list"
  | "freshList"
  | "pending"
  | "freshPending"
  | "freshExecuted"
  | "signed"
  | "freshSigned"
  | "upgrades"
  | "upgradesFresh";

/** A page's loader data for `path`: the loader answers at once, its deferred values come later. */
function open(loader: Loader, path: string, params: Record<string, string> = {}) {
  const result = loader({ request: new Request(`http://localhost${path}`), params, context: {} });
  return (result as { data: Record<Key, Promise<unknown>> }).data;
}

/** Whether `promise` settles without the fake clock moving (without any upstream read). */
async function atOnce(promise: Promise<unknown>): Promise<Record<string, unknown> | null> {
  let value: Record<string, unknown> | null = null;
  void promise.then((v) => {
    value = v as Record<string, unknown>;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return value;
}

/** Three blocks with no page open: neither the head nor governance (30 s) read is served now. */
async function pause(w: ReturnType<typeof liveWorld>) {
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    w.nextBlock();
  }
  expect(servedHeadNow()).toBeNull();
}

/** The emergency upgrades' execution transactions, as the node returns them. */
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

const asOfHead = { asOf: { block: HEAD.toString() } };

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

describe("pages after a pause", () => {
  it("the upgrade page: the upgrade as last shown at once, as of its block, then the current one", async () => {
    const w = liveWorld();
    await backfilled();
    const id = w.upgradeId;
    const before = open(upgradePage, `/app/proposals/${id}`, { id });
    const shown = (await settle(before.detail)) as Record<string, unknown>;
    expect(shown).not.toHaveProperty("asOf");
    expect(await settle(before.freshDetail)).toBeNull();
    await settle(before.sets);

    await pause(w);
    const after = open(upgradePage, `/app/proposals/${id}`, { id });
    const first = await atOnce(after.detail);
    expect(first).toMatchObject({ id, state: shown.state, ...asOfHead });
    const current = (await settle(after.freshDetail)) as Record<string, unknown>;
    expect(current).toMatchObject({ id, state: shown.state });
    expect(current).not.toHaveProperty("asOf");
    expect(
      String((current.governance as { latestBlock: { number: unknown } }).latestBlock.number)
    ).toBe((HEAD + 3n).toString());
    await settle(after.sets);
  });

  it("the emergency upgrade page: the upgrade and its execution as last shown, then the current ones", async () => {
    const w = liveWorld({ transaction });
    await backfilled();
    const id = w.emergencyId;
    const before = open(emergencyPage, `/app/emergency/${id}`, { id });
    expect(await settle(before.lastShown)).toBeNull();
    const execution = (await settle(before.executed)) as { txHash: string; calls: unknown[] };
    expect(execution.calls).toHaveLength(1);
    await settle(before.verifiedFresh);

    await pause(w);
    const after = open(emergencyPage, `/app/emergency/${id}`, { id });
    expect(await atOnce(after.lastShown)).toMatchObject({
      overview: { id, state: 6 },
      execution: { txHash: execution.txHash, calls: execution.calls },
      ...asOfHead,
    });
    expect(await settle(after.detail)).toMatchObject({ id, state: 6 });
    await settle(after.verifiedFresh);
  });

  it("the lists and the overview: as last shown at once, as of their block, then the current ones", async () => {
    const w = liveWorld();
    await backfilled();
    // The four pages at once, as tabs opened together after the pause (one after another, the
    // later ones would find the head the first one read, and show the current data at once).
    const pages = () => ({
      home: open(home, "/"),
      upgrades: open(upgradeList, "/app/proposals?history=all"),
      emergency: open(emergencyList, "/app/emergency"),
      vetoes: open(vetoList, "/app/l2-cancellations"),
    });
    const before = pages();
    const current = {
      upgrades: (await settle(before.upgrades.list)) as { upgrades: unknown[] },
      executed: (await settle(before.emergency.executed)) as { items: unknown[] },
      signed: (await settle(before.vetoes.signed)) as { vetoes: unknown[] },
      count: (await settle(before.home.upgrades)) as { open: number; total: number },
    };
    expect(current.upgrades.upgrades.length).toBeGreaterThan(0);
    for (const value of Object.values(current)) expect(value).not.toHaveProperty("asOf");
    await settle(
      Promise.all(
        [before.home, before.emergency, before.vetoes].flatMap((data) => Object.values(data))
      ).catch(() => {})
    );

    await pause(w);
    const after = pages();
    // Each with its block; the Safe-fed pending ids and vetoes also as from older copies (stale).
    expect(await atOnce(after.upgrades.list)).toMatchObject({ ...current.upgrades, ...asOfHead });
    expect(await atOnce(after.emergency.executed)).toMatchObject({
      items: current.executed.items,
      ...asOfHead,
    });
    expect(await atOnce(after.emergency.pending)).toMatchObject({ stale: true, ...asOfHead });
    expect(await atOnce(after.vetoes.signed)).toMatchObject({
      vetoes: current.signed.vetoes,
      stale: true,
      ...asOfHead,
    });
    expect(await atOnce(after.home.upgrades)).toMatchObject({
      open: current.count.open,
      total: current.count.total,
      source: { lastRun: false, safeFetchedAt: null, asOfBlock: HEAD.toString() },
    });
    const fresh = {
      upgrades: await settle(after.upgrades.freshList),
      executed: await settle(after.emergency.freshExecuted),
      pending: await settle(after.emergency.freshPending),
      signed: await settle(after.vetoes.freshSigned),
      count: await settle(after.home.upgradesFresh),
    };
    expect(fresh.upgrades).toMatchObject({ upgrades: current.upgrades.upgrades });
    expect(fresh.executed).toMatchObject({ items: current.executed.items, fromLastRun: false });
    expect(fresh.pending).toMatchObject({ stale: false });
    expect(fresh.signed).toMatchObject({ vetoes: current.signed.vetoes, stale: false });
    expect(fresh.count).toMatchObject({ source: null });
    for (const value of Object.values(fresh)) expect(value).not.toHaveProperty("asOf");
  });

  it("JSON after the same pause answers only with what it reads at the newest block", async () => {
    const w = liveWorld();
    await backfilled();
    const id = w.upgradeId;
    await settle(open(upgradeList, "/app/proposals?history=all").list);
    await settle(open(upgradePage, `/app/proposals/${id}`, { id }).detail);
    await settle(Promise.resolve());

    await pause(w);
    const json = async (loader: Loader, path: string, params: Record<string, string> = {}) => {
      const response = (await settle(
        Promise.resolve(
          loader({ request: new Request(`http://localhost${path}`), params, context: {} })
        )
      )) as Response;
      return JSON.stringify(await response.json());
    };
    const heads = w.fake.requests("eth_getBlockByNumber").length;
    const list = await json(upgradesJson, "/api/upgrades?history=all");
    expect(JSON.parse(list).upgrades.length).toBeGreaterThan(0);
    expect(list).not.toContain('"asOf"');
    // It read the newest block for it (nothing kept from the pages stood in).
    expect(w.fake.requests("eth_getBlockByNumber").length).toBeGreaterThan(heads);
  });
});
