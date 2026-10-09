import { clearCache, invalidate } from "@/.server/cache";
import { createLane } from "@/.server/chain/jsonrpc";
import { indexedL2Governors, l2GovernorIndex } from "@/.server/chain/l2-index";
import { createLogIndex } from "@/.server/chain/log-index";
import {
  activeL2Proposals,
  findL2ProposalForUpgrade,
  getL2Proposal,
  notStartedUpgrades,
  refreshVetoableL2,
} from "@/.server/flows/l2";
import { listL2Vetoes, loadL2VetoList } from "@/.server/flows/l2-veto";
import { l2ChainHead, l2HistoryLane, resetRpcClients } from "@/.server/rpc";
import { l2GovernorAbi } from "@/common/abis";
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toEventSelector,
  toHex,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockHash, fakeChain, rawLog } from "../support/fake-chain";
import {
  DAY,
  ERA_URL,
  type EraProposal,
  FINAL,
  FIRST_LOG,
  GOVERNORS,
  HEAD,
  executionTx,
  fakeEra,
  firstBlockAt,
  proposalIdOf,
  timeOf,
} from "../support/fake-era";
import { FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

// The ZKsync Era governors' log index (B4): one eth_getLogs for the three pinned governors'
// ProposalCreated/Executed/Canceled history, the tail above Era's 'finalized' block per Era head,
// and windows ("the last 24 days") cut by each event's block timestamp instead of a header search
// for the window's first block. The flows must answer exactly what the timestamp search answered.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const GUARDIANS: Address = "0x0000000000000000000000000000000000000a02";
const T = GOVERNORS.token;
const G = GOVERNORS.govOps;
const P = GOVERNORS.protocol;

const TOPICS = ["ProposalCreated", "ProposalExecuted", "ProposalCanceled"].map(
  (name) =>
    encodeEventTopics({ abi: l2GovernorAbi, eventName: name as "ProposalCreated" })[0] as Hex
);

const state = vi.hoisted(() => ({
  network: {} as Record<string, unknown>,
  // ProtocolUpgradeHandler.upgradeState(l1 id) on L1, by id.
  upgradeStates: new Map<string, number>(),
  l1Reads: 0,
}));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

vi.mock("@/.server/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/rpc")>();
  return {
    ...actual,
    l1: {
      readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
        state.l1Reads++;
        if (functionName === "hashL2Proposal") {
          const p = args[0] as {
            targets: Address[];
            values: bigint[];
            calldatas: Hex[];
            description: string;
          };
          return BigInt(
            keccak256(
              encodeAbiParameters(
                [
                  { type: "address[]" },
                  { type: "uint256[]" },
                  { type: "bytes[]" },
                  { type: "bytes32" },
                ],
                [p.targets, p.values, p.calldatas, keccak256(toHex(p.description))]
              )
            )
          );
        }
        if (functionName === "upgradeState")
          return state.upgradeStates.get(String(args[0]).toLowerCase()) ?? 4;
        throw new Error(`unexpected L1 read ${functionName}`);
      },
    },
  };
});

const GOV = {
  guardians: {
    address: GUARDIANS,
    nonce: "0",
    members: [],
    thresholds: { cancelL2Proposal: 5 },
    domain: { name: "Guardians", version: "1", chainId: 1, verifyingContract: GUARDIANS },
  },
};
// JSON's governance and pages', told apart (the engine's Era refresh reads pages').
const reads = vi.hoisted(() => ({ json: 0, page: 0 }));
vi.mock("@/.server/governance", () => ({
  governance: async () => {
    reads.json++;
    return GOV;
  },
}));
vi.mock("@/.server/page-governance", () => {
  const page = async () => {
    reads.page++;
    return GOV;
  };
  return {
    pageGovernance: page,
    governanceFor: async (freshness: string) => {
      if (freshness === "page") return page();
      reads.json++;
      return GOV;
    },
  };
});
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => ({ groups: [], errors: [], anomalies: 0 }),
  // No copies held (a page's first list is then the fresh one).
  collectHeldMessages: async () => null,
}));

/** Mainnet with an Era RPC: the pinned governors are indexed. */
const MAINNET = {
  chainId: 1,
  isDevNode: false,
  forkBlock: null,
  l2RpcUrl: ERA_URL,
  l2Governors: { ...GOVERNORS },
  upgradeHandler: PUH,
  overrides: [],
  clientVersion: "Geth/v1.15",
};
/** The same governors where they are not the pinned ones: read on demand, as before the index. */
const UNPINNED = { ...MAINNET, chainId: 11155111 };

const headTime = timeOf(HEAD);
const VETO_FROM = firstBlockAt(headTime - 24n * DAY);
const START_FROM = firstBlockAt(headTime - 30n * DAY);
const body = (k: number) => toHex(`upgrade ${k}`);

function scenario(): EraProposal[] {
  return [
    {
      governor: T,
      description: "old, executed",
      created: FIRST_LOG,
      executed: FIRST_LOG + 400_000n,
      state: 7,
    },
    { governor: T, description: "a block before the window", created: VETO_FROM - 1n, state: 1 },
    { governor: T, description: "the window's first block", created: VETO_FROM, state: 1 },
    { governor: G, description: "pending on GovOps", created: VETO_FROM + 5_000n, state: 0 },
    {
      governor: G,
      description: "canceled",
      created: VETO_FROM + 10n,
      canceled: VETO_FROM + 20n,
      state: 2,
    },
    { governor: T, description: "defeated", created: VETO_FROM + 30n, state: 3 },
    { governor: T, description: "in the tail", created: HEAD - 100n, state: 0 },
    {
      governor: P,
      description: "upgrade one",
      created: START_FROM - 900_000n,
      executed: START_FROM + 100n,
      state: 7,
      message: body(1),
    },
    {
      governor: P,
      description: "executed a block before the 30 days",
      created: START_FROM - 800_000n,
      executed: START_FROM - 1n,
      state: 7,
      message: body(2),
    },
    {
      governor: P,
      description: "started on L1",
      created: START_FROM - 700_000n,
      executed: START_FROM + 200n,
      state: 7,
      message: body(3),
    },
    {
      governor: P,
      description: "no message",
      created: START_FROM - 600_000n,
      executed: START_FROM + 300n,
      state: 7,
    },
    {
      governor: P,
      description: "not in a batch yet",
      created: HEAD - 600n,
      executed: HEAD - 50n,
      state: 7,
      message: body(4),
      l1Batch: null,
    },
  ];
}

function upstream(proposals = scenario(), chain: Parameters<typeof fakeEra>[1] = {}) {
  const era = fakeEra(proposals, chain);
  const fake = fakeJsonRpc({ handle: (call) => era.handle(call) });
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(ERA_URL)) throw new Error("only the fake Era is reachable here");
    return fake.fetch(input, init);
  });
  return { era, fake };
}

/** eth_getLogs ranges whose end is at or below the boundary: the backfill's. */
const backfillQueries = (era: ReturnType<typeof fakeEra>, boundary = FINAL) =>
  era.chain.queries.filter((q) => q.to <= boundary);

/** Starts over with `net`: new settings generation, empty caches. */
function settings(net: Record<string, unknown>) {
  resetRpcClients();
  clearCache();
  state.network = net;
}

beforeEach(() => {
  settings(MAINNET);
  state.l1Reads = 0;
  state.upgradeStates = new Map([
    [keccak256(body(1)).toLowerCase(), 0],
    [keccak256(body(2)).toLowerCase(), 0],
    [keccak256(body(3)).toLowerCase(), 3],
    [keccak256(body(4)).toLowerCase(), 0],
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the L2 governor index", () => {
  it("reads the pinned governors' whole history in one topic-filtered eth_getLogs, then only the tail per head", async () => {
    const { era } = upstream();
    const read = await l2GovernorIndex().read();

    const backfill = backfillQueries(era);
    expect(backfill.map((q) => [q.from, q.to])).toEqual([[FIRST_LOG, FINAL]]);
    for (const query of era.chain.queries) {
      expect((query.filter.address as string[]).map((a) => a.toLowerCase()).sort()).toEqual(
        [T, G, P].map((a) => a.toLowerCase()).sort()
      );
      // Only the three events: the governors' votes would overflow an answer.
      expect(query.filter.topics).toEqual([TOPICS]);
    }
    // And the tail above Era's 'finalized' block, read for this head (beside the backfill).
    expect(era.chain.ranges().sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([
      [FIRST_LOG, FINAL],
      [FINAL + 1n, HEAD],
    ]);
    // 12 created, 6 executed, 1 canceled; no vote.
    expect(read.events).toHaveLength(19);
    expect(read.events.filter((e) => e.eventName === "ProposalCreated")).toHaveLength(12);
    expect(read.events.find((e) => e.eventName === "ProposalCanceled")).toMatchObject({
      governor: G,
      proposalId: proposalIdOf("canceled"),
      final: true,
    });
    // A tail event is not final.
    const tail = read.events.find((e) => e.log.blockNumber === HEAD - 100n);
    expect(tail).toMatchObject({ eventName: "ProposalCreated", final: false });
    expect(read.head.head.number).toBe(HEAD);
    expect(l2GovernorIndex().status()).toMatchObject({
      state: "ready",
      strategy: "full-range",
      deployBlock: FIRST_LOG.toString(),
      finalizedTo: FINAL.toString(),
      governors: [T, G, P],
    });

    // The same head again: nothing read.
    await l2GovernorIndex().read();
    expect(era.chain.queries).toHaveLength(2);

    // A new head: one read above the last boundary (what passed it is promoted from this read).
    era.setHead(HEAD + 30n);
    invalidate("l2-latest-block");
    const next = await l2GovernorIndex().read();
    expect(era.chain.ranges().slice(2)).toEqual([[FINAL + 1n, HEAD + 30n]]);
    expect(next.events).toHaveLength(19);
    expect(next.events.find((e) => e.log.blockNumber === HEAD - 100n)?.final).toBe(false);
  });

  it("chunks the backfill for an Era RPC that caps block ranges, with the same events", async () => {
    const { era } = upstream(scenario(), { cap: 5_000_000n });
    const read = await l2GovernorIndex().read();
    const backfill = backfillQueries(era)
      .map((q) => [q.from, q.to] as const)
      .filter(([from, to]) => to - from <= 5_000_000n)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    expect(backfill.length).toBeGreaterThan(4);
    // Contiguous from the first log to the boundary.
    expect(backfill[0]?.[0]).toBe(FIRST_LOG);
    expect(backfill.at(-1)?.[1]).toBe(FINAL);
    for (let i = 1; i < backfill.length; i++)
      expect(backfill[i]?.[0]).toBe((backfill[i - 1]?.[1] as bigint) + 1n);
    expect(l2GovernorIndex().status()).toMatchObject({ state: "ready", strategy: "chunked" });
    expect(read.events).toHaveLength(19);
  });

  it("drops a tail log that a reorg removed", async () => {
    const { era } = upstream();
    const before = await l2GovernorIndex().read();
    expect(before.events.some((e) => e.log.blockNumber === HEAD - 100n)).toBe(true);

    // Another block at the same height, without that proposal.
    era.proposals.splice(
      era.proposals.findIndex((p) => p.description === "in the tail"),
      1
    );
    era.relog();
    era.setHead(HEAD, { salt: 1 });
    invalidate("l2-latest-block");
    const after = await l2GovernorIndex().read();
    expect(after.head.head.hash).toBe(blockHash(HEAD, 1));
    expect(after.events.some((e) => e.log.blockNumber === HEAD - 100n)).toBe(false);
    expect(after.events).toHaveLength(18);
  });

  it("treats nothing as final when Era does not know the 'finalized' tag", async () => {
    const { era } = upstream(scenario(), { finalized: null });
    const read = await l2GovernorIndex().read();
    // Every read is the whole range and nothing is kept as final (which is why the flows scan
    // their windows on demand instead while Era does not know the tag: see the flows below).
    expect(era.chain.ranges()).toEqual([[FIRST_LOG, HEAD]]);
    expect(read.events).toHaveLength(19);
    expect(read.events.every((e) => !e.final)).toBe(true);
    era.setHead(HEAD + 5n);
    era.chain.options.finalized = null;
    invalidate("l2-latest-block");
    await l2GovernorIndex().read();
    expect(era.chain.ranges().slice(1)).toEqual([[FIRST_LOG, HEAD + 5n]]);
  });

  it("never assumes a boundary when Era's 'finalized' read fails: the last one known, else an error", async () => {
    const { era } = upstream();
    const handle = era.handle;
    let finalized: "answer" | "fail" = "fail";
    era.handle = (call) =>
      finalized === "fail" &&
      call.method === "eth_getBlockByNumber" &&
      call.params[0] === "finalized"
        ? new FakeRpcError(-32603, "internal error")
        : handle(call);
    const head = () => {
      invalidate("l2-latest-block");
      return l2ChainHead();
    };

    // Nothing known yet: the head is not served, and the list is an L2 error, never empty.
    await expect(head()).rejects.toThrow(/internal error/);
    await expect(activeL2Proposals()).rejects.toThrow();
    const listed = await listL2Vetoes();
    expect(listed.vetoable).toEqual([]);
    expect(listed.l2Error).toEqual(expect.any(String));

    // One real answer; a failure after it stands on that block.
    finalized = "answer";
    expect((await head())?.safe).toBe(FINAL);
    finalized = "fail";
    era.setHead(HEAD + 10n);
    expect(await head()).toMatchObject({ head: { number: HEAD + 10n }, safe: FINAL });

    // A backend whose 'finalized' is behind answers for its own read, but the block known stays.
    finalized = "answer";
    era.setHead(HEAD + 20n, { finalized: FINAL - 500n });
    expect((await head())?.safe).toBe(FINAL - 500n);
    finalized = "fail";
    expect((await head())?.safe).toBe(FINAL);

    // A settings change forgets it.
    settings(MAINNET);
    await expect(head()).rejects.toThrow(/internal error/);
  });

  it("reads Era's head beside a backfill's eth_getLogs chunks, never queued behind them", async () => {
    const CAP = 100_000n;
    const { era } = upstream(scenario(), { cap: CAP });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = era.handle;
    // Chunks (ranges within the cap) are held until released; the whole-range probe is not.
    era.handle = (call) => {
      if (call.method !== "eth_getLogs") return handle(call);
      const { fromBlock, toBlock } = call.params[0] as { fromBlock: Hex; toBlock: Hex };
      return BigInt(toBlock) - BigInt(fromBlock) <= CAP
        ? gate.then(() => handle(call))
        : handle(call);
    };
    const backfill = l2GovernorIndex().startBackfill();
    const history = await l2HistoryLane();
    // Every eth_getLogs slot is taken.
    await vi.waitFor(() => {
      const stats = history?.stats();
      expect(stats?.inFlight).toBe(stats?.inFlightLimit);
    });

    invalidate("l2-latest-block");
    const timeout = new Promise<"queued">((resolve) => setTimeout(() => resolve("queued"), 1_000));
    const read = await Promise.race([l2ChainHead(), timeout]);
    expect(read).toMatchObject({ head: { number: HEAD }, safe: FINAL });

    release();
    await backfill;
    expect(l2GovernorIndex().status()).toMatchObject({ state: "ready", strategy: "chunked" });
  });

  it("indexes only the pinned governors still in use, and only with an Era RPC", () => {
    expect(indexedL2Governors(MAINNET)).toEqual({ addresses: [T, G, P], fromBlock: FIRST_LOG });
    const replaced = "0x0000000000000000000000000000000000000e01";
    expect(
      indexedL2Governors({ ...MAINNET, l2Governors: { ...GOVERNORS, token: replaced } })
    ).toEqual({ addresses: [G, P], fromBlock: FIRST_LOG });
    expect(indexedL2Governors({ ...MAINNET, l2RpcUrl: null })).toBeNull();
    // Sepolia pins other governors: mainnet's addresses there are read on demand.
    expect(indexedL2Governors(UNPINNED)).toBeNull();
  });

  it("is discarded by a settings change; the new settings get their own", async () => {
    upstream();
    const index = l2GovernorIndex();
    await index.read();
    expect(index.status().state).toBe("ready");
    settings(MAINNET);
    expect(l2GovernorIndex()).not.toBe(index);
    await expect(index.read()).rejects.toThrow(/data source changed/);
    expect(l2GovernorIndex().status().state).toBe("idle");
    await expect(l2GovernorIndex().read()).resolves.toMatchObject({ events: expect.any(Array) });
  });
});

describe("a log index over several addresses and named topics", () => {
  const A: Address = "0x00000000000000000000000000000000000000a1";
  const B: Address = "0x00000000000000000000000000000000000000b1";
  const X = toEventSelector("X(uint256)");
  const Y = toEventSelector("Y(uint256)");

  function index(override?: (query: { from: bigint; to: bigint }) => unknown[] | undefined) {
    const chain = fakeChain({
      address: A,
      logs: [
        { address: A, blockNumber: 100n, logIndex: 0, topics: [X] },
        { address: B, blockNumber: 200n, logIndex: 0, topics: [X] },
        { address: B, blockNumber: 300n, logIndex: 0, topics: [Y] },
      ],
      override,
    });
    const fake = fakeJsonRpc({ handle: (call) => chain.handle(call) });
    const lane = createLane({
      url: "http://rpc.invalid",
      label: "test",
      maxBatch: 20,
      maxInFlight: 4,
      fetch: fake.fetch as typeof fetch,
    });
    const logIndex = createLogIndex({
      label: "test",
      lane,
      address: [A, B],
      topic0: [X],
      deployBlock: 1n,
      head: async () => ({ head: { number: 1_000n, hash: blockHash(1_000n) }, safe: 900n }),
      retryDelayMs: 1,
      retryMs: 0,
    });
    return { chain, logIndex };
  }

  it("asks for both addresses and the named topic0 in one filter", async () => {
    const { chain, logIndex } = index();
    const logs = await logIndex.logs();
    expect(logs.map((l) => l.blockNumber)).toEqual([100n, 200n]);
    expect(chain.queries[0]?.filter).toMatchObject({ address: [A, B], topics: [[X]] });
  });

  it.each([
    [
      "a log with another topic0",
      () => rawLog({ address: B }, { blockNumber: 300n, logIndex: 0, topics: [Y] }),
    ],
    [
      "a log from another address",
      () =>
        rawLog(
          { address: "0x00000000000000000000000000000000000000c1" },
          { blockNumber: 300n, logIndex: 0, topics: [X] }
        ),
    ],
  ])("refuses an answer with %s", async (_name, log) => {
    const { logIndex } = index((q) => (q.to <= 900n ? [log()] : undefined));
    await logIndex.startBackfill();
    expect(logIndex.status()).toMatchObject({ state: "unavailable" });
    expect(logIndex.status().error).toMatch(/does not ask for|another address/);
  });
});

describe("the flows on the index", () => {
  it("list the vetoable proposals the timestamp search listed, without searching headers", async () => {
    const { era } = upstream();
    const indexed = await activeL2Proposals();
    expect(era.count("eth_getBlockByNumber", true)).toBe(0);
    // State reads only for proposals the index does not show executed or canceled.
    const stateReads = era.count("eth_call");

    settings(UNPINNED);
    const { era: legacyEra } = upstream();
    const scanned = await activeL2Proposals();
    // The old path does search (so the comparison means something).
    expect(legacyEra.count("eth_getBlockByNumber", true)).toBeGreaterThan(0);

    expect(indexed).toEqual(scanned);
    expect(indexed.map((p) => p.description)).toEqual([
      "the window's first block",
      "in the tail",
      "pending on GovOps",
    ]);
    expect(indexed[0]).toMatchObject({
      governor: T,
      governorName: "ZkTokenGovernor",
      proposalId: proposalIdOf("the window's first block").toString(),
      state: "Active",
      idMatchesLocal: true,
      idMatchesContract: true,
    });
    // The canceled proposal's state is known from its ProposalCanceled log.
    expect(stateReads).toBe(legacyEra.count("eth_call") - 1);
  });

  it("answer /api/vetoes the same way on both paths", async () => {
    upstream();
    const indexed = await listL2Vetoes();
    settings(UNPINNED);
    upstream();
    const scanned = await listL2Vetoes();
    expect(JSON.parse(JSON.stringify(indexed, bigints))).toEqual(
      JSON.parse(JSON.stringify(scanned, bigints))
    );
    expect(indexed.vetoable).toHaveLength(3);
    expect(indexed.l2Error).toBeNull();
  });

  it("find the startable upgrades the timestamp search found, without searching headers", async () => {
    const { era } = upstream();
    const indexed = await notStartedUpgrades();
    expect(era.count("eth_getBlockByNumber", true)).toBe(0);
    settings(UNPINNED);
    upstream();
    const scanned = await notStartedUpgrades();
    expect(indexed).toEqual(scanned);
    const one = era.proposals.find((p) => p.description === "upgrade one") as EraProposal;
    expect(indexed).toEqual([
      {
        l2ProposalId: toHex(proposalIdOf("upgrade one")),
        executedTx: executionTx(one),
        ok: true,
        l1ProposalId: keccak256(body(1)),
        data: {
          l2BatchNumber: "0x1f4",
          l2MessageIndex: "0x5",
          l2TxNumberInBatch: "0x3",
          proof: [expect.stringMatching(/^0x0+99$/)],
          proposal: body(1),
        },
      },
      {
        l2ProposalId: toHex(proposalIdOf("no message")),
        executedTx: expect.any(String),
        ok: false,
        error: "No L2 → L1 message in the execution",
      },
      {
        l2ProposalId: toHex(proposalIdOf("not in a batch yet")),
        executedTx: expect.any(String),
        ok: false,
        error: "Not included in an L1 batch yet",
      },
    ]);
  });

  it("find an upgrade's L2 proposal without the batch, without searching headers", async () => {
    const { era } = upstream();
    const one = era.proposals.find((p) => p.description === "upgrade one") as EraProposal;
    const created = Number(timeOf(one.executed as bigint) + 2n * DAY);
    const indexed = await findL2ProposalForUpgrade(keccak256(body(1)), created, {
      strategy: "legacy",
    });
    expect(era.count("eth_getBlockByNumber", true)).toBe(0);
    settings(UNPINNED);
    upstream();
    const scanned = await findL2ProposalForUpgrade(keccak256(body(1)), created, {
      strategy: "legacy",
    });
    expect(indexed).toEqual(scanned);
    expect(indexed).toEqual({
      governor: P,
      proposalId: proposalIdOf("upgrade one").toString(),
      executedTx: executionTx(one),
    });

    // An execution timed after the creation is outside the window on both paths.
    const later = era.proposals.find((p) => p.description === "started on L1") as EraProposal;
    const before = Number(timeOf(later.executed as bigint) - 10n);
    settings(MAINNET);
    upstream();
    expect(
      await findL2ProposalForUpgrade(keccak256(body(3)), before, { strategy: "legacy" })
    ).toBeNull();
    settings(UNPINNED);
    upstream();
    expect(
      await findL2ProposalForUpgrade(keccak256(body(3)), before, { strategy: "legacy" })
    ).toBeNull();
  });

  it("read a veto's proposal from the index: found with its state, or not found as an answer", async () => {
    const { era } = upstream();
    const found = await getL2Proposal(T, proposalIdOf("old, executed"));
    expect(found).toMatchObject({ description: "old, executed", state: "Executed" });
    expect(await getL2Proposal(T, 12_345n)).toBeNull();
    // Another governor's proposal is not this governor's.
    expect(await getL2Proposal(G, proposalIdOf("old, executed"))).toBeNull();
    expect(era.count("eth_getBlockByNumber", true)).toBe(0);
    // No snapshot / voting delay reads: only state().
    expect(era.calls.filter((c) => c.method === "eth_call")).toHaveLength(1);
  });

  it("serve a request within the Era head's 4 s from memory, and re-read only the tail and states after", async () => {
    const { era, fake } = upstream();
    await activeL2Proposals();
    const posts = fake.posts.length;
    await activeL2Proposals();
    await getL2Proposal(T, proposalIdOf("the window's first block"));
    expect(fake.posts.length).toBe(posts);

    // A new Era head (another hash, so the window stays put): its tail, the states again; a
    // state change shows at once.
    const pending = era.proposals.find((p) => p.description === "pending on GovOps");
    if (pending) pending.state = 3;
    era.setHead(HEAD, { salt: 2 });
    invalidate("l2-latest-block");
    const calls = era.calls.length;
    const listed = await activeL2Proposals();
    expect(listed.map((p) => p.description)).toEqual(["the window's first block", "in the tail"]);
    const methods = era.calls.slice(calls).map((c) => c.method);
    expect(methods.filter((m) => m === "eth_getLogs")).toHaveLength(1);
    expect(methods.filter((m) => m === "eth_getBlockByHash")).toHaveLength(0);
    expect(methods.filter((m) => m === "eth_getBlockByNumber")).toHaveLength(2); // latest, finalized
  });

  it("are refreshed by the sync engine (while an Era page is on screen: the engine decides)", async () => {
    const { era, fake } = upstream();
    // A page views the vetoable list.
    await activeL2Proposals();
    // The next Era head (a block later, so the 24-day window drops its first block).
    era.setHead(HEAD + 2n);
    expect(await refreshVetoableL2()).toBe(true);
    // The request after the refresh: everything from memory, at the refreshed head.
    const posts = fake.posts.length;
    const listed = await activeL2Proposals();
    expect(fake.posts.length).toBe(posts);
    expect(listed.map((p) => p.description)).toEqual(["in the tail", "pending on GovOps"]);
    expect((await l2GovernorIndex().read()).head.head.number).toBe(HEAD + 2n);
  });

  it("the engine's refresh takes the Guardians' address from pages' governance, never JSON's full read", async () => {
    upstream();
    await activeL2Proposals();
    reads.json = 0;
    reads.page = 0;
    expect(await refreshVetoableL2()).toBe(true);
    expect(reads.json).toBe(0);
    expect(reads.page).toBeGreaterThan(0);
  });

  it("a page's vetoable list (/, the veto list) takes the Guardians' address from the page's governance, never JSON's full read", async () => {
    upstream();
    reads.json = 0;
    reads.page = 0;
    const loading = loadL2VetoList({ freshness: "page" });
    const first = await loading.vetoable;
    const fresh = await loading.freshVetoable;
    await loading.signed;
    // Every listed proposal's id was hashed on L1 at the Guardians the page's governance names.
    for (const answer of [first, fresh]) {
      expect(answer.vetoable).toHaveLength(3);
      expect(answer.vetoable.every((p) => p.idMatchesContract === true)).toBe(true);
    }
    expect(reads.json).toBe(0);
    expect(reads.page).toBe(1);
    // JSON's list keeps JSON's governance, read once for the whole answer.
    reads.page = 0;
    const json = await listL2Vetoes();
    expect(json.vetoable.every((p) => p.idMatchesContract === true)).toBe(true);
    expect(reads.page).toBe(0);
    expect(reads.json).toBe(1);
  });

  it("a veto's proposal is checked against the governance it is given (a page's), else JSON's", async () => {
    upstream();
    const id = proposalIdOf("the window's first block");
    reads.json = 0;
    reads.page = 0;
    const { pageGovernance } = await import("@/.server/page-governance");
    expect(await getL2Proposal(T, id, { gov: pageGovernance })).toMatchObject({
      idMatchesContract: true,
    });
    expect(reads).toEqual({ json: 0, page: 1 });
    expect(await getL2Proposal(T, id)).toMatchObject({ idMatchesContract: true });
    expect(reads).toEqual({ json: 1, page: 1 });
  });

  it("never serve an older Era head after the engine's refresh is answered by a backend behind", async () => {
    const { era, fake } = upstream();
    // A proposal created at HEAD + 3, seen by a request at HEAD + 5.
    era.proposals.push({ governor: T, description: "fresh", created: HEAD + 3n, state: 0 });
    era.relog();
    era.setHead(HEAD + 5n);
    const id = proposalIdOf("fresh");
    expect((await activeL2Proposals()).map((p) => p.description)).toContain("fresh");
    expect(await getL2Proposal(T, id)).toMatchObject({ description: "fresh" });

    // The engine's refresh is answered by an Era backend a few blocks behind.
    era.setHead(HEAD);
    expect(await refreshVetoableL2()).toBe(true);
    era.setHead(HEAD + 5n);
    // Requests keep the head already served, from memory.
    const posts = fake.posts.length;
    expect((await l2ChainHead())?.head.number).toBe(HEAD + 5n);
    expect((await activeL2Proposals()).map((p) => p.description)).toContain("fresh");
    expect(await getL2Proposal(T, id)).toMatchObject({ description: "fresh" });
    expect(fake.posts.length).toBe(posts);

    // A newer Era head from the engine is served.
    era.setHead(HEAD + 7n);
    expect(await refreshVetoableL2()).toBe(true);
    expect((await l2ChainHead())?.head.number).toBe(HEAD + 7n);
    // So is another block at that height, named by a later read (a reorg)...
    era.setHead(HEAD + 7n, { salt: 3 });
    expect(await refreshVetoableL2()).toBe(true);
    expect((await l2ChainHead())?.head.hash).toBe(blockHash(HEAD + 7n, 3));
    // ...and the same block named again (served for another 4 s).
    expect(await refreshVetoableL2()).toBe(true);
    expect((await l2ChainHead())?.head.hash).toBe(blockHash(HEAD + 7n, 3));
  });

  it("scan their windows on demand while Era does not know the 'finalized' tag, never the whole history", async () => {
    const { era } = upstream(scenario(), { finalized: null });
    const vetoable = await activeL2Proposals();
    const startable = await notStartedUpgrades();
    // Nothing would be final: the index would re-read every governor log at each Era head.
    expect(era.chain.queries.length).toBeGreaterThan(0);
    for (const query of era.chain.queries) expect(query.from).toBeGreaterThanOrEqual(START_FROM);
    // And the engine has nothing to refresh ahead of requests.
    expect(await refreshVetoableL2()).toBe(false);

    // The answers of the on-demand path.
    settings(UNPINNED);
    upstream(scenario(), { finalized: null });
    expect(vetoable).toEqual(await activeL2Proposals());
    expect(startable).toEqual(await notStartedUpgrades());
    expect(vetoable.map((p) => p.description)).toEqual([
      "the window's first block",
      "in the tail",
      "pending on GovOps",
    ]);
  });

  it("keep an execution's L2 → L1 message for good only once the execution is final", async () => {
    const { era } = upstream();
    const receipts = (description: string) => {
      const p = era.proposals.find((q) => q.description === description) as EraProposal;
      return era.calls.filter(
        (c) => c.method === "eth_getTransactionReceipt" && c.params[0] === executionTx(p)
      ).length;
    };
    const pendingId = toHex(proposalIdOf("not in a batch yet"));
    const first = await notStartedUpgrades();
    expect(first.find((u) => u.l2ProposalId === pendingId)).toMatchObject({
      ok: false,
      error: "Not included in an L1 batch yet",
    });

    // Era puts the execution (in the tail, above 'finalized') in a batch; same Era head.
    const pending = era.proposals.find((p) => p.description === "not in a batch yet");
    if (pending) pending.l1Batch = 501n;
    const second = await notStartedUpgrades();
    expect(second.find((u) => u.l2ProposalId === pendingId)).toMatchObject({
      ok: true,
      l1ProposalId: keccak256(body(4)),
      data: { l2BatchNumber: "0x1f5" },
    });
    // Its receipt is read again; a final execution's is read once.
    expect(receipts("not in a batch yet")).toBe(2);
    expect(receipts("upgrade one")).toBe(1);
  });

  it("report an Era outage as an L2 error without the RPC URL, never as an empty answer", async () => {
    const { era } = upstream();
    const handle = era.handle;
    era.handle = (call) =>
      call.method === "eth_getBlockByNumber"
        ? new FakeRpcError(-32603, `internal error at ${ERA_URL}`)
        : handle(call);
    const result = await listL2Vetoes();
    expect(result.vetoable).toEqual([]);
    expect(result.l2Error).toEqual(expect.any(String));
    expect(result.l2Error).not.toContain("era.invalid");
    await expect(getL2Proposal(T, proposalIdOf("defeated"))).rejects.toThrow();
  });
});

function bigints(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
