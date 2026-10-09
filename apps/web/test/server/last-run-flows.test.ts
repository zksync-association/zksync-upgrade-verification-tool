import { clearCache, peek } from "@/.server/cache";
import { type ProvisionalOutcome, parseLogs } from "@/.server/chain/log-index";
import { IndexIntegrityError, puhIndex } from "@/.server/chain/puh-index";
import { loadEmergencyList } from "@/.server/flows/emergency";
import {
  getStandardUpgradeCore,
  listStandardUpgrades,
  loadStandardUpgrade,
} from "@/.server/flows/standard";
import { resetLogCaches } from "@/.server/logs";
import { resetRpcClients } from "@/.server/rpc";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainLog, PUH_TOPICS, fakeChain, puhHistory, rawLog } from "../support/fake-chain";
import { type FakeCall, type FakePost, fakeJsonRpc } from "../support/fake-jsonrpc";

// Pages on the history the last run saved (persist/chain-cache.ts), while this run's backfill
// re-reads it: the upgrade list, an upgrade's start and the executed emergency upgrades answer at
// once from it, say so (`fromLastRun`), and are followed by this run's answer; nothing that acts on
// it (an execution) uses it, nothing from it is kept, and JSON waits for this run's history.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
// The last run's boundary.
const SAVED = FINAL - 3_000n;
const CAP = 10_000n;
const time = (n: bigint) => 1_700_000_000n + n * 12n;

const state = vi.hoisted(() => ({
  network: {} as Record<string, unknown>,
  // id → [creationTimestamp, executed]
  status: new Map<string, [number, boolean]>(),
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

// Contract state from `state.status`; logs and headers from the fake chain through the lanes.
vi.mock("@/.server/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/rpc")>();
  const l1 = {
    readContract: async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
      const status = state.status.get(args[0].toLowerCase());
      if (functionName === "upgradeState") {
        if (!status) return UPGRADE_STATES.None;
        return status[1] ? UPGRADE_STATES.Done : UPGRADE_STATES.LegalVetoPeriod;
      }
      if (functionName === "upgradeStatus") {
        const [created, executed] = status ?? [0, false];
        return [created, 0, false, false, executed];
      }
      throw new Error(`Unexpected ${functionName}`);
    },
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      to: "0x0000000000000000000000000000000000000001",
      input: "0x",
    }),
  };
  return { ...actual, l1, l1State: l1 };
});

const GOVERNANCE = {
  network: { isDevNode: false, standardLegalVetoDays: 3, chainId: 1 },
  upgradeHandler: PUH,
  securityCouncil: {
    address: PUH,
    members: [],
    thresholds: { approveUpgrade: 6 },
    domain: { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: PUH },
  },
  guardians: {
    address: PUH,
    members: [],
    thresholds: { approveUpgrade: 5, extendLegalVeto: 2 },
    domain: { name: "Guardians", version: "1", chainId: 1, verifyingContract: PUH },
  },
  emergencyUpgradeBoard: {
    address: PUH,
    zkFoundation: "0x0000000000000000000000000000000000000f00",
    domain: { name: "EmergencyUpgradeBoard", version: "1", chainId: 1, verifyingContract: PUH },
  },
};
vi.mock("@/.server/governance", () => ({ governance: async () => GOVERNANCE }));
vi.mock("@/.server/flows/l2", () => ({ findL2ProposalForUpgrade: async () => null }));
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => ({ groups: [], errors: [], anomalies: 0 }),
  collectHeldMessages: async () => null,
}));
vi.mock("@/.server/signatures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/signatures")>()),
  verifySignatureSet: async () => {
    throw new Error("signature sets are not part of these tests");
  },
  firstSignatureSet: async (_: unknown, fresh: Promise<unknown>) => fresh,
}));

const isHeldChunk = (call: FakeCall) => {
  if (call.method !== "eth_getLogs") return false;
  const filter = call.params[0] as { fromBlock: Hex; toBlock: Hex };
  const from = BigInt(filter.fromBlock);
  const to = BigInt(filter.toBlock);
  return to - from <= CAP && from <= SAVED;
};

/**
 * The chain, with this run's backfill below the saved boundary held until `release()`; the
 * history the last run saved (up to SAVED), optionally changed, is seeded.
 */
function upstream(change: (logs: ChainLog[]) => ChainLog[] = (logs) => logs) {
  const history = puhHistory(DEPLOY, FINAL);
  const chain = fakeChain({
    address: PUH,
    logs: history.logs,
    cap: CAP,
    head: { number: HEAD },
    finalized: FINAL,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fake = fakeJsonRpc({
    handle: (call) => chain.handle(call),
    intercept: async (post: FakePost) => {
      if (post.calls.some(isHeldChunk)) await gate;
      return undefined;
    },
  });
  vi.stubGlobal("fetch", fake.fetch);
  for (const upgrade of history.upgrades)
    state.status.set(upgrade.id.toLowerCase(), [Number(time(upgrade.started)), true]);
  for (const emergency of history.emergencies)
    state.status.set(emergency.id.toLowerCase(), [0, true]);
  const saved = change(history.logs.filter((l) => l.blockNumber <= SAVED)).map((l) =>
    rawLog({ address: PUH }, l)
  );
  const outcomes: ProvisionalOutcome[] = [];
  puhIndex().seedProvisional(
    {
      chainId: 1,
      address: PUH,
      deployBlock: DEPLOY,
      finalizedTo: SAVED,
      logs: parseLogs(saved, { addresses: [PUH] }, DEPLOY, SAVED),
    },
    (outcome) => outcomes.push(outcome)
  );
  return { history, chain, release, outcomes };
}

const byBlock = (a: ChainLog, b: ChainLog) =>
  a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex;

/** Whether `promise` has settled within `ms`. */
async function settles(promise: Promise<unknown>, ms = 50): Promise<boolean> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return done;
}

beforeEach(() => {
  resetRpcClients();
  resetLogCaches();
  clearCache();
  state.status.clear();
  state.network = {
    chainId: 1,
    upgradeHandler: PUH,
    upgradeHandlerDeployBlock: DEPLOY,
    blockTimeSeconds: 12,
    logCanary: {
      address: PUH,
      topic0: toEventSelector("ChangeSecurityCouncil(address,address)"),
      blockNumber: DEPLOY,
    },
    isDevNode: false,
    forkBlock: null,
    safeTxServiceUrl: null,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the upgrade list", () => {
  it("is answered on a page from the last run's history, and JSON waits for this run's", async () => {
    const { history, release } = upstream();
    const ids = history.upgrades.map((u) => u.id).reverse();

    const page = await listStandardUpgrades({ allHistory: true, freshness: "page" });
    expect(page.fromLastRun).toBe(true);
    expect(page.upgrades.map((u) => u.id)).toEqual(ids);
    // Nothing from it is kept for the detail pages.
    for (const id of ids) expect(peek(`started:${id.toLowerCase()}`)).toBeNull();

    const strict = listStandardUpgrades({ allHistory: true });
    expect(await settles(strict)).toBe(false);
    release();
    const json = await strict;
    expect(json.fromLastRun).toBeUndefined();
    expect(json.upgrades.map((u) => u.id)).toEqual(ids);
    expect("fromLastRun" in json).toBe(false);

    // Verified: pages get this run's answer too.
    const after = await listStandardUpgrades({ allHistory: true, freshness: "page" });
    expect(after.fromLastRun).toBeUndefined();
  });
});

describe("a last run's history this run's would not hold", () => {
  // What the file holds is the last run's word, never the chain's: it may make a page wait for
  // this run's history, but never fail it, and never in the chain's name.

  it("naming an upgrade's start twice: the page waits for this run's start, no integrity error", async () => {
    let upgradeId: Hex | null = null;
    const { release, outcomes } = upstream((logs) => {
      const started = logs.find((l) => l.topics[0] === PUH_TOPICS.UpgradeStarted) as ChainLog;
      upgradeId = started.topics[1] as Hex;
      return [...logs, { ...started, blockNumber: started.blockNumber + 3n }].sort(byBlock);
    });
    const id = upgradeId as unknown as Hex;
    const loading = loadStandardUpgrade(id, { freshness: "page" });
    expect(await settles(loading)).toBe(false);
    release();
    const page = await loading;
    expect(page.overview.started.fromLastRun).toBeUndefined();
    expect(page.startedCheck).toBeNull();
    await page.execution;
    await vi.waitFor(() => expect(outcomes).toEqual(["mismatch"]));
  });

  it("with a start whose data does not decode: the page's list comes from this run's history", async () => {
    const { history, release } = upstream((logs) =>
      logs.map((log) =>
        log.topics[0] === PUH_TOPICS.UpgradeStarted ? { ...log, data: "0x" as Hex } : log
      )
    );
    const listing = listStandardUpgrades({ allHistory: true, freshness: "page" });
    expect(await settles(listing)).toBe(false);
    release();
    const page = await listing;
    expect(page.fromLastRun).toBeUndefined();
    expect(page.upgrades.map((u) => u.id)).toEqual(history.upgrades.map((u) => u.id).reverse());
  });

  it("listing an upgrade twice: the page's list comes from this run's history", async () => {
    const { history, release } = upstream((logs) => {
      const started = logs.find((l) => l.topics[0] === PUH_TOPICS.UpgradeStarted) as ChainLog;
      return [...logs, { ...started, blockNumber: started.blockNumber + 3n }].sort(byBlock);
    });
    const listing = listStandardUpgrades({ allHistory: true, freshness: "page" });
    expect(await settles(listing)).toBe(false);
    release();
    const page = await listing;
    expect(page.fromLastRun).toBeUndefined();
    expect(page.upgrades.map((u) => u.id)).toEqual(history.upgrades.map((u) => u.id).reverse());
  });

  it.each([
    [
      "that does not decode",
      (logs: ChainLog[]) =>
        logs.map((log) =>
          log.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted
            ? { ...log, topics: [log.topics[0] as Hex] }
            : log
        ),
    ],
    [
      "listed twice",
      (logs: ChainLog[]) => {
        const executed = logs.find(
          (l) => l.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted
        ) as ChainLog;
        return [...logs, { ...executed, blockNumber: executed.blockNumber + 2n }].sort(byBlock);
      },
    ],
  ])(
    "with an emergency execution %s: the page's list comes from this run's history",
    async (_, change) => {
      const { history, release } = upstream(change);
      const loading = await loadEmergencyList({ allHistory: true, freshness: "page" });
      expect(await settles(loading.executedFirst)).toBe(false);
      release();
      const first = await loading.executedFirst;
      expect(first.fromLastRun).toBe(false);
      const ids = history.emergencies.map((e) => e.id).reverse();
      expect(first.items.map((e) => e.id)).toEqual(ids);
      expect((await loading.executed).map((e) => e.id)).toEqual(ids);
    }
  );
});

describe("an upgrade's start", () => {
  it("comes from the last run's history on a page, labelled, and is confirmed by this run's", async () => {
    const { history, release, outcomes } = upstream();
    const upgrade = history.upgrades[3] as (typeof history.upgrades)[number];

    const loading = await loadStandardUpgrade(upgrade.id, { freshness: "page" });
    expect(loading.overview.started).toMatchObject({
      id: upgrade.id,
      blockNumber: upgrade.started.toString(),
      idMatches: true,
      fromLastRun: true,
    });
    expect(loading.startedCheck).not.toBeNull();
    // What acts on the proposal waits for this run's start.
    expect(await settles(loading.execution)).toBe(false);
    expect(await settles(loading.startedCheck as Promise<unknown>)).toBe(false);

    release();
    const confirmed = await loading.startedCheck;
    expect(confirmed?.fromLastRun).toBeUndefined();
    expect(confirmed?.txHash).toBe(loading.overview.started.txHash);
    await loading.execution;
    expect(outcomes).toEqual(["verified"]);

    // JSON's start is this run's.
    const json = await getStandardUpgradeCore(upgrade.id);
    expect(json.started.fromLastRun).toBeUndefined();
    expect("fromLastRun" in json.started).toBe(false);
  });

  it("that this run's history contradicts fails the page's check, never passes", async () => {
    let upgradeId: Hex | null = null;
    const { release, outcomes } = upstream((logs) =>
      logs.map((log) => {
        if (log.topics[0] !== PUH_TOPICS.UpgradeStarted || upgradeId) return log;
        upgradeId = log.topics[1] as Hex;
        // Same block and proposal, another log (and so another transaction).
        return { ...log, logIndex: log.logIndex + 1 };
      })
    );
    const id = upgradeId as unknown as Hex;
    const loading = await loadStandardUpgrade(id, { freshness: "page" });
    expect(loading.overview.started.fromLastRun).toBe(true);
    release();
    await expect(loading.startedCheck).rejects.toBeInstanceOf(IndexIntegrityError);
    await expect(loading.execution).rejects.toBeInstanceOf(IndexIntegrityError);
    expect(outcomes).toEqual(["mismatch"]);
  });
});

describe("the executed emergency upgrades", () => {
  it("are listed on a page from the last run's history, then from this run's", async () => {
    const { history, release } = upstream();
    const ids = history.emergencies.map((e) => e.id).reverse();
    const loading = await loadEmergencyList({ allHistory: true, freshness: "page" });
    const first = await loading.executedFirst;
    expect(first.fromLastRun).toBe(true);
    expect(first.items.map((e) => e.id)).toEqual(ids);
    expect(await settles(loading.executed)).toBe(false);
    release();
    expect((await loading.executed).map((e) => e.id)).toEqual(ids);
  });

  it("are listed for JSON from this run's history only", async () => {
    const { history, release } = upstream();
    const loading = await loadEmergencyList({ allHistory: true });
    expect(await settles(loading.executedFirst)).toBe(false);
    release();
    const first = await loading.executedFirst;
    expect(first.fromLastRun).toBe(false);
    expect((await loading.executed).map((e) => e.id)).toEqual(
      history.emergencies.map((e) => e.id).reverse()
    );
  });
});
