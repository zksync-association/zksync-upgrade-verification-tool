import { respond } from "@/.server/api";
import { clearCache, invalidate } from "@/.server/cache";
import { IndexIncomplete } from "@/.server/chain/log-index";
import { IndexIntegrityError, PuhIndex, puhIndex } from "@/.server/chain/puh-index";
import {
  UpgradeNotFound,
  getStandardUpgradeCore,
  getStandardUpgradeOverview,
  listStandardUpgrades,
  loadStandardUpgrade,
} from "@/.server/flows/standard";
import { resetLogCaches } from "@/.server/logs";
import { resetRpcClients } from "@/.server/rpc";
import { type UpgradeProposal, encodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, numberToHex, pad, toEventSelector, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainLog, PUH_TOPICS, fakeChain, puhHistory, txHash } from "../support/fake-chain";
import { FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

// Standard upgrades on the ProtocolUpgradeHandler's log index, against a fake chain behind the
// real lanes: mainnet's handler history in shape, Infura's 10,000-block getLogs cap.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
const time = (n: bigint) => 1_700_000_000n + n * 12n;

const state = vi.hoisted(() => ({
  network: {} as Record<string, unknown>,
  chain: null as null | {
    handle: (call: { id: unknown; method: string; params: unknown[] }) => unknown;
  },
  // id → [creationTimestamp, securityCouncilApprovalTimestamp, executed]
  status: new Map<string, [number, number, boolean]>(),
  headers: [] as bigint[],
  transactions: [] as Hex[],
  // When set, the governance and status reads wait here (see `together`).
  barrier: null as null | ((name: string) => Promise<void>),
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

// The flows' viem client: contract state from `state.status`, headers and logs from the fake chain.
vi.mock("@/.server/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/rpc")>();
  const { FakeRpcError } = await import("../support/fake-jsonrpc");
  const l1 = {
    readContract: async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
      await state.barrier?.("status");
      const status = state.status.get(args[0].toLowerCase());
      if (functionName === "upgradeState") {
        if (!status) return UPGRADE_STATES.None;
        return status[2] ? UPGRADE_STATES.Done : UPGRADE_STATES.LegalVetoPeriod;
      }
      if (functionName === "upgradeStatus") {
        const [created, approved, executed] = status ?? [0, 0, false];
        return [created, approved, false, false, executed];
      }
      throw new Error(`Unexpected ${functionName}`);
    },
    // Not an approval call: the evidence keeps its transaction and decodes nothing more.
    getTransaction: async ({ hash }: { hash: Hex }) => {
      state.transactions.push(hash);
      return { hash, to: "0x0000000000000000000000000000000000000001", input: "0x" };
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      state.headers.push(blockNumber);
      return { number: blockNumber, timestamp: 1_700_000_000n + blockNumber * 12n };
    },
    request: async ({ method, params }: { method: string; params: unknown[] }) => {
      const result = state.chain?.handle({ id: 0, method, params });
      if (result instanceof FakeRpcError) throw new Error(result.message);
      return result;
    },
  };
  return { ...actual, l1, l1State: l1 };
});

vi.mock("@/.server/governance", () => ({
  governance: async () => {
    await state.barrier?.("governance");
    return {
      network: { isDevNode: false, standardLegalVetoDays: 3 },
      upgradeHandler: PUH,
      securityCouncil: { address: PUH, members: [], thresholds: { approveUpgrade: 6 } },
      guardians: {
        address: PUH,
        members: [],
        thresholds: { approveUpgrade: 5, extendLegalVeto: 2 },
      },
    };
  },
}));
vi.mock("@/.server/flows/l2", () => ({ findL2ProposalForUpgrade: async () => null }));
vi.mock("@/.server/signatures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/signatures")>()),
  verifySignatureSet: async () => {
    throw new Error("signature sets are not part of these tests");
  },
}));

const proposal = (n: number): UpgradeProposal => ({
  calls: [{ target: `0x${(0xa00 + n).toString(16).padStart(40, "0")}`, value: "0", data: "0x" }],
  executor: zeroAddress,
  salt: pad(numberToHex(0xbeef00 + n), { size: 32 }) as Hex,
});
const startedLog = (p: UpgradeProposal, blockNumber: bigint): ChainLog => ({
  blockNumber,
  logIndex: 3,
  topics: [PUH_TOPICS.UpgradeStarted, upgradeProposalId(p)],
  data: encodeUpgradeProposal(p),
});

// Two more upgrades: one inside the 45-day window (final), one in the unfinalized tail.
const RECENT = proposal(1);
const RECENT_BLOCK = FINAL - 1_000n;
const TAIL = proposal(2);
const TAIL_BLOCK = FINAL + 10n;

function upstream(
  options: {
    logs?: ChainLog[];
    override?: Parameters<typeof fakeChain>[0]["override"];
  } = {}
) {
  const history = puhHistory(DEPLOY, FINAL);
  const logs = options.logs ?? [
    ...history.logs,
    startedLog(RECENT, RECENT_BLOCK),
    startedLog(TAIL, TAIL_BLOCK),
  ];
  const chain = fakeChain({
    address: PUH,
    logs,
    cap: 10_000n,
    head: { number: HEAD },
    finalized: FINAL,
    override: options.override,
  });
  state.chain = chain;
  const fake = fakeJsonRpc({ handle: (call) => chain.handle(call) });
  vi.stubGlobal("fetch", fake.fetch);
  for (const upgrade of history.upgrades)
    state.status.set(upgrade.id.toLowerCase(), [Number(time(upgrade.started)), 1, true]);
  state.status.set(upgradeProposalId(RECENT), [Number(time(RECENT_BLOCK)), 0, false]);
  state.status.set(upgradeProposalId(TAIL), [Number(time(TAIL_BLOCK)), 0, false]);
  return { history, chain, fake };
}

/**
 * A barrier for reads that must run at the same time: each named read waits until all of them
 * have begun, and fails after `ms` if one never does (it would have to wait for another to end).
 */
function together(names: string[], ms = 2_000) {
  const begun = new Set<string>();
  const waiting: (() => void)[] = [];
  return (name: string) =>
    new Promise<void>((resolve, reject) => {
      begun.add(name);
      if (names.every((n) => begun.has(n))) {
        for (const release of waiting.splice(0)) release();
        return resolve();
      }
      const timer = setTimeout(
        () => reject(new Error(`${name} ran alone; begun: ${[...begun].join(", ")}`)),
        ms
      );
      waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
}

/** `promise`, or a rejection with `message` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const startLog = (chain: ReturnType<typeof fakeChain>, id: Hex) =>
  chain.options.logs.find(
    (log) => log.topics[0] === PUH_TOPICS.UpgradeStarted && log.topics[1] === id
  ) as ChainLog;

beforeEach(() => {
  resetRpcClients();
  resetLogCaches();
  clearCache();
  state.status.clear();
  state.headers = [];
  state.transactions = [];
  state.barrier = null;
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
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listStandardUpgrades", () => {
  it("lists the 45-day window as before: same window, shape and order", async () => {
    upstream();
    const list = await listStandardUpgrades({ allHistory: false });
    // Today's formula: head − 45 days of 12 s blocks, or the deployment block.
    const from = HEAD - (45n * 86_400n) / 12n;
    expect(list.fromBlock).toBe(from.toString());
    expect(list.allHistory).toBe(false);
    expect(list.upgrades.map((u) => u.id)).toEqual([
      upgradeProposalId(TAIL),
      upgradeProposalId(RECENT),
    ]);
    expect(list.upgrades[1]).toEqual({
      id: upgradeProposalId(RECENT),
      proposal: RECENT,
      idMatches: true,
      blockNumber: RECENT_BLOCK.toString(),
      txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      state: UPGRADE_STATES.LegalVetoPeriod,
      stateLabel: expect.any(String),
      createdAt: Number(time(RECENT_BLOCK)),
      approvedBySecurityCouncil: false,
      approvedByGuardians: false,
      legalVetoExtended: false,
    });
  });

  it("lists every upgrade since deployment, newest first", async () => {
    const { history } = upstream();
    const list = await listStandardUpgrades({ allHistory: true });
    expect(list.fromBlock).toBe(DEPLOY.toString());
    expect(list.allHistory).toBe(true);
    expect(list.upgrades.map((u) => u.id)).toEqual([
      upgradeProposalId(TAIL),
      upgradeProposalId(RECENT),
      ...history.upgrades.map((u) => u.id).reverse(),
    ]);
    expect(list.upgrades.every((u) => u.idMatches)).toBe(true);
  });

  it("errors instead of listing a partial history when the RPC refuses logs", async () => {
    upstream({ override: () => new FakeRpcError(-32000, "logs are disabled") });
    await expect(listStandardUpgrades({ allHistory: true })).rejects.toThrow("logs are disabled");
  });

  it("never waits on (or fails with) a detail lookup of a listed id still in flight", async () => {
    upstream();
    let fail!: (error: Error) => void;
    const real = PuhIndex.prototype.single;
    vi.spyOn(PuhIndex.prototype, "single").mockImplementation(function (this: PuhIndex, ...args) {
      if (args[0] !== "UpgradeStarted") return real.apply(this, args as never) as never;
      // The detail lookup needs the whole history and is still waiting on the backfill.
      return new Promise<never>((_, reject) => {
        fail = reject;
      });
    });
    const detail = getStandardUpgradeCore(upgradeProposalId(RECENT)).catch((e: unknown) => e);
    // The 45-day window is covered: the list answers while that lookup is still out.
    const list = await within(
      listStandardUpgrades({ allHistory: false }),
      3_000,
      "the list waited on the detail lookup"
    );
    expect(list.upgrades.map((u) => u.id)).toEqual([
      upgradeProposalId(TAIL),
      upgradeProposalId(RECENT),
    ]);
    fail(new IndexIncomplete("ProtocolUpgradeHandler", DEPLOY, null));
    expect(await detail).toBeInstanceOf(IndexIncomplete);
  });
});

describe("one upgrade", () => {
  it("reads an executed upgrade with no getLogs beyond the tail and no header search", async () => {
    const { history, chain } = upstream();
    await puhIndex().startBackfill();
    const upgrade = history.upgrades[4] as (typeof history.upgrades)[number];
    const before = chain.queries.length;
    const overview = await getStandardUpgradeOverview(upgrade.id);
    expect(overview.started).toMatchObject({
      id: upgrade.id,
      idMatches: true,
      blockNumber: upgrade.started.toString(),
    });
    expect(overview.state).toBe(UPGRADE_STATES.Done);
    expect(overview.executedTx).toMatch(/^0x[0-9a-f]{64}$/);
    // Only the unfinalized tail (F, head] is read for this head; no timestamp search.
    expect(chain.ranges().slice(before)).toEqual([[FINAL + 1n, HEAD]]);
    expect(state.headers).toEqual([]);
    // Again at the same head: nothing at all.
    const again = chain.queries.length;
    await getStandardUpgradeOverview(upgrade.id);
    expect(chain.queries.length).toBe(again);
  });

  it("reads the state at the cached head, and finds the execution once the head moves", async () => {
    const { chain } = upstream();
    await puhIndex().startBackfill();
    const id = upgradeProposalId(RECENT);
    // A page load caches the head; the upgrade is executed in the next block.
    await getStandardUpgradeOverview(id);
    const executed: ChainLog = {
      blockNumber: HEAD + 1n,
      logIndex: 0,
      topics: [PUH_TOPICS.UpgradeExecuted, id],
    };
    chain.options.logs.push(executed);
    chain.options.head = { number: HEAD + 1n };
    state.status.set(id, [Number(time(RECENT_BLOCK)), 0, true]);
    // The state is the one at the cached head (read at that block), like the index's view.
    const before = await getStandardUpgradeOverview(id);
    expect(before.state).toBe(UPGRADE_STATES.LegalVetoPeriod);
    expect(before.executedTx).toBeNull();
    // The head expires: state and execution are both read at the new head.
    invalidate("latest-block");
    const overview = await getStandardUpgradeOverview(id);
    expect(overview.state).toBe(UPGRADE_STATES.Done);
    expect(overview.executedTx).toBe(txHash(executed));
  });

  it("takes a recorded approval's transaction from the index, without a header search", async () => {
    const { history, chain } = upstream();
    const upgrade = history.upgrades[2] as (typeof history.upgrades)[number];
    const approval = chain.options.logs.find(
      (log) =>
        log.topics[0] === PUH_TOPICS.UpgradeApprovedBySecurityCouncil &&
        log.topics[1] === upgrade.id
    ) as ChainLog;
    const loading = await loadStandardUpgrade(upgrade.id);
    const evidence = await loading.evidence;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.state).toEqual({
      status: "done",
      detail: "Approved by the Security Council",
      txHash: txHash(approval),
      // When: the approval time the handler records (no block header read for it).
      at: expect.any(String),
    });
    expect(state.transactions).toEqual([txHash(approval)]);
    expect(state.headers).toEqual([]);
    await Promise.allSettled([loading.sets, loading.execution, loading.l2Proposal]);
  });

  it("falls back to the bounded legacy lookup only when the index is unavailable", async () => {
    const { history } = upstream({
      // Address-only queries (the index) are refused; topic queries (the legacy lookup) answer.
      override: ({ filter }) =>
        filter.topics === undefined ? new FakeRpcError(-32000, "logs are disabled") : undefined,
    });
    const upgrade = history.upgrades[7] as (typeof history.upgrades)[number];
    const core = await getStandardUpgradeCore(upgrade.id);
    expect(core.started).toMatchObject({ id: upgrade.id, blockNumber: upgrade.started.toString() });
    // The failed tail read (its own POST, not the backfill's) is what sent the lookup to the
    // fallback; the backfill's own retries end in "unavailable" too.
    await vi.waitFor(() => expect(puhIndex().status().state).toBe("unavailable"));
    // The legacy path: a header search for the creation time, then a 17-block topic query.
    expect(state.headers.length).toBeGreaterThan(0);
    const legacy = state.chain as ReturnType<typeof fakeChain>;
    const topical = legacy.queries.filter((q) => q.filter.topics !== undefined);
    expect(topical).toHaveLength(1);
    expect(topical[0]?.filter.topics).toEqual([PUH_TOPICS.UpgradeStarted, upgrade.id]);
    expect((topical[0]?.to ?? 0n) - (topical[0]?.from ?? 0n)).toBe(16n);
  });

  it("does not fall back while a complete index answers", async () => {
    const { history } = upstream();
    const upgrade = history.upgrades[7] as (typeof history.upgrades)[number];
    await getStandardUpgradeCore(upgrade.id);
    const chain = state.chain as ReturnType<typeof fakeChain>;
    expect(chain.queries.every((q) => q.filter.topics === undefined)).toBe(true);
    expect(state.headers).toEqual([]);
  });

  it("reports a known upgrade missing from a complete index as an integrity error, never not found", async () => {
    const history = puhHistory(DEPLOY, FINAL);
    const upgrade = history.upgrades[5] as (typeof history.upgrades)[number];
    upstream({
      logs: history.logs.filter(
        (log) => !(log.topics[0] === PUH_TOPICS.UpgradeStarted && log.topics[1] === upgrade.id)
      ),
    });
    const error = await getStandardUpgradeCore(upgrade.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexIntegrityError);
    expect(error).not.toBeInstanceOf(UpgradeNotFound);
    expect(String(error)).toContain(upgrade.id);
    // The JSON API answers 502, not 404.
    const response = await respond(() => getStandardUpgradeCore(upgrade.id));
    expect(response.status).toBe(502);
  });

  it("asks to retry, without an integrity error, for a start not in the tail yet", async () => {
    upstream({ logs: puhHistory(DEPLOY, FINAL).logs });
    const id = upgradeProposalId(TAIL);
    const error = await getStandardUpgradeCore(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IndexIntegrityError);
    expect(error).not.toBeInstanceOf(UpgradeNotFound);
    expect(String(error)).toMatch(/Try again/);
  });

  it("looks once more at a fresh head before reporting a start missing", async () => {
    const { chain } = upstream({ logs: puhHistory(DEPLOY, FINAL).logs });
    const id = upgradeProposalId(TAIL);
    // The index answers at the cached head; the upgrade starts in the next block.
    await puhIndex().startBackfill();
    await puhIndex().logs();
    chain.options.logs.push(startedLog(TAIL, HEAD + 1n));
    chain.options.head = { number: HEAD + 1n };
    state.status.set(id, [Number(time(HEAD + 1n)), 0, false]);
    const core = await getStandardUpgradeCore(id);
    expect(core.started.blockNumber).toBe((HEAD + 1n).toString());
  });

  it("starts the governance read, the status read and the start lookup together", async () => {
    const { history } = upstream();
    await puhIndex().startBackfill();
    const barrier = together(["governance", "status", "start"]);
    state.barrier = barrier;
    const real = PuhIndex.prototype.single;
    vi.spyOn(PuhIndex.prototype, "single").mockImplementation(async function (
      this: PuhIndex,
      ...args
    ) {
      if (args[0] === "UpgradeStarted") await barrier("start");
      return real.apply(this, args as never) as never;
    });
    const upgrade = history.upgrades[3] as (typeof history.upgrades)[number];
    const core = await getStandardUpgradeCore(upgrade.id);
    expect(core.started.blockNumber).toBe(upgrade.started.toString());
  });

  it("reports a live index that does not cover the history yet, without the legacy lookup", async () => {
    const { history, chain } = upstream();
    vi.spyOn(PuhIndex.prototype, "single").mockRejectedValue(
      new IndexIncomplete("ProtocolUpgradeHandler", DEPLOY, FINAL - 100_000n)
    );
    const upgrade = history.upgrades[7] as (typeof history.upgrades)[number];
    const error = await getStandardUpgradeCore(upgrade.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexIncomplete);
    expect(state.headers).toEqual([]);
    expect(chain.queries.filter((q) => q.filter.topics !== undefined)).toEqual([]);
    expect((await respond(() => getStandardUpgradeCore(upgrade.id))).status).toBe(502);
  });

  it("answers 502, never not found, when the legacy lookup misses a known upgrade", async () => {
    const history = puhHistory(DEPLOY, FINAL);
    const upgrade = history.upgrades[7] as (typeof history.upgrades)[number];
    upstream({
      logs: history.logs.filter(
        (log) => !(log.topics[0] === PUH_TOPICS.UpgradeStarted && log.topics[1] === upgrade.id)
      ),
      // The index is unavailable; the legacy topic lookup answers, without the log.
      override: ({ filter }) =>
        filter.topics === undefined ? new FakeRpcError(-32000, "logs are disabled") : undefined,
    });
    const error = await getStandardUpgradeCore(upgrade.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UpgradeNotFound);
    expect(String(error)).toContain("exists on-chain");
    expect((await respond(() => getStandardUpgradeCore(upgrade.id))).status).toBe(502);
  });

  it("never keeps a start the index read from its tail, even once the boundary passes it", async () => {
    let move = true;
    upstream({
      override: ({ from }) => {
        // While the tail (F, head] is served, the chain moves on: a new head, and the
        // 'finalized' tag a whole epoch further, past the start's block.
        if (move && from === FINAL + 1n) {
          move = false;
          const chain = state.chain as ReturnType<typeof fakeChain>;
          chain.options.head = { number: HEAD + 3n };
          chain.options.finalized = FINAL + 32n;
          invalidate("latest-block");
        }
        return undefined;
      },
    });
    const chain = state.chain as ReturnType<typeof fakeChain>;
    await puhIndex().startBackfill();
    const single = vi.spyOn(PuhIndex.prototype, "single");
    const id = upgradeProposalId(TAIL);
    const first = await getStandardUpgradeCore(id);
    expect(first.started.blockNumber).toBe(TAIL_BLOCK.toString());
    expect(move).toBe(false);

    // A reorg above the old boundary moved the start two blocks: the next lookup sees it.
    startLog(chain, id).blockNumber = FINAL + 12n;
    const second = await getStandardUpgradeCore(id);
    expect(second.started.blockNumber).toBe((FINAL + 12n).toString());
    expect(single.mock.calls.filter(([name]) => name === "UpgradeStarted")).toHaveLength(2);
    // Now read at or below the boundary from a fresh read: kept for good.
    await getStandardUpgradeCore(id);
    expect(single.mock.calls.filter(([name]) => name === "UpgradeStarted")).toHaveLength(2);
  });

  it("keeps a final start for good and reads an unfinalized one again", async () => {
    upstream();
    const single = vi.spyOn(PuhIndex.prototype, "single");
    const starts = () => single.mock.calls.filter(([name]) => name === "UpgradeStarted").length;

    await getStandardUpgradeCore(upgradeProposalId(RECENT));
    await getStandardUpgradeCore(upgradeProposalId(RECENT));
    expect(starts()).toBe(1);

    single.mockClear();
    await getStandardUpgradeCore(upgradeProposalId(TAIL));
    invalidate("latest-block");
    await getStandardUpgradeCore(upgradeProposalId(TAIL));
    expect(starts()).toBe(2);
  });

  it("seeds the detail lookup from the list for final starts only", async () => {
    upstream();
    await listStandardUpgrades({ allHistory: false });
    const single = vi.spyOn(PuhIndex.prototype, "single");
    await getStandardUpgradeCore(upgradeProposalId(RECENT));
    await getStandardUpgradeCore(upgradeProposalId(TAIL));
    expect(single.mock.calls.filter(([name]) => name === "UpgradeStarted")).toEqual([
      ["UpgradeStarted", upgradeProposalId(TAIL)],
    ]);
  });
});
