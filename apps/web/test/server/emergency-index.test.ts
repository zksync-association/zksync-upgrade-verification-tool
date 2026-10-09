import { clearCache } from "@/.server/cache";
import { puhIndex } from "@/.server/chain/puh-index";
import { listEmergencyUpgrades, loadEmergencyList } from "@/.server/flows/emergency";
import { findEmergencyEvent } from "@/.server/flows/emergency-event";
import { findBlockByTimestamp, resetLogCaches } from "@/.server/logs";
import { resetRpcClients } from "@/.server/rpc";
import { logHistoryStatus } from "@/.server/status";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import { type Address, type Hex, type PublicClient, numberToHex, pad, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChainLog,
  PUH_TOPICS,
  type PuhHistory,
  fakeChain,
  puhHistory,
  txHash,
} from "../support/fake-chain";
import { FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

// Executed emergency upgrades on the ProtocolUpgradeHandler's log index, against a fake chain
// behind the real lanes: mainnet's handler history in shape, 12 s slots with missed ones.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
const CANARY_TOPIC = toEventSelector("ChangeSecurityCouncil(address,address)");
// Every 97th slot is missed, as on mainnet now and then.
const time = (n: bigint) => 1_700_000_000n + 12n * (n + n / 97n);
const WEEK = BigInt(EMERGENCY_RECENT_DAYS * 24 * 60 * 60);

const state = vi.hoisted(() => ({
  network: {} as Record<string, unknown>,
  chain: null as null | {
    handle: (call: { id: unknown; method: string; params: unknown[] }) => unknown;
  },
  // Emergency id → block of its execution, for the archive bisection.
  executedAt: new Map<string, bigint>(),
  archiveReads: 0,
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
  const { FakeRpcError } = await import("../support/fake-jsonrpc");
  const l1 = {
    getBlockNumber: async () => HEAD,
    readContract: async ({
      functionName,
      args,
      blockNumber,
    }: { functionName: string; args: [Hex]; blockNumber?: bigint }) => {
      if (functionName !== "upgradeStatus") throw new Error(`Unexpected ${functionName}`);
      if (blockNumber !== undefined) state.archiveReads++;
      const at = state.executedAt.get(args[0].toLowerCase());
      return [0, 0, false, false, at !== undefined && (blockNumber ?? HEAD) >= at];
    },
    request: async ({ method, params }: { method: string; params: unknown[] }) => {
      const result = state.chain?.handle({ id: 0, method, params });
      if (result instanceof FakeRpcError) throw new Error(result.message);
      return result;
    },
  };
  return { ...actual, l1, l1State: l1 };
});

// The archive bisection's upgradeStatus reads are direct eth_calls (chain/call.ts).
vi.mock("@/.server/chain/call", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/chain/call")>();
  return {
    ...actual,
    callFn: async (params: { functionName: string; args: [Hex]; blockNumber?: bigint }) => {
      if (params.functionName !== "upgradeStatus") return actual.callFn(params as never);
      if (params.blockNumber !== undefined) state.archiveReads++;
      const at = state.executedAt.get(params.args[0].toLowerCase());
      return [0, 0, false, false, at !== undefined && (params.blockNumber ?? HEAD) >= at];
    },
  };
});

vi.mock("@/.server/governance", () => ({
  governance: async () => ({
    network: { isDevNode: false },
    upgradeHandler: PUH,
    securityCouncil: { address: PUH, members: [] },
    guardians: { address: PUH, members: [] },
    emergencyUpgradeBoard: { address: PUH, zkFoundation: PUH, domain: {} },
  }),
}));
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => ({ groups: [], errors: [], anomalies: 0 }),
}));

const emergencyId = (n: number) => pad(numberToHex(0xf000 + n), { size: 32 }) as Hex;
const emergencyLog = (n: number, blockNumber: bigint): ChainLog => ({
  blockNumber,
  logIndex: 2,
  topics: [PUH_TOPICS.EmergencyUpgradeExecuted, emergencyId(n)],
});

/** The first block at or after head − 7 days, found the way the old code did. */
function oldCut() {
  const client = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: time(blockNumber),
    }),
  } as unknown as PublicClient;
  return findBlockByTimestamp(client, time(HEAD) - WEEK, DEPLOY, HEAD, null);
}

async function upstream(
  options: { override?: Parameters<typeof fakeChain>[0]["override"]; extra?: ChainLog[] } = {}
) {
  const history: PuhHistory = puhHistory(DEPLOY, FINAL);
  const cut = await oldCut();
  // Executions right around the 7-day cut, and one in the unfinalized tail.
  const extra = options.extra ?? [
    emergencyLog(1, cut - 1n),
    emergencyLog(2, cut),
    emergencyLog(3, cut + 1n),
    emergencyLog(4, HEAD - 5n),
  ];
  const logs = [...history.logs, ...extra].sort((a, b) =>
    a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1
  );
  const chain = fakeChain({
    address: PUH,
    logs,
    cap: 10_000n,
    head: { number: HEAD },
    finalized: FINAL,
    timestampOf: time,
    override: options.override,
  });
  state.chain = chain;
  const fake = fakeJsonRpc({ handle: (call) => chain.handle(call) });
  vi.stubGlobal("fetch", fake.fetch);
  const executions = logs.filter((log) => log.topics[0] === PUH_TOPICS.EmergencyUpgradeExecuted);
  for (const log of executions)
    state.executedAt.set((log.topics[1] as Hex).toLowerCase(), log.blockNumber);
  /** Header reads by block number (not 'latest'/'finalized'), per POST. */
  const headerPosts = () =>
    fake.posts
      .map((post) =>
        post.calls
          .filter(
            (c) => c.method === "eth_getBlockByNumber" && String(c.params[0]).startsWith("0x")
          )
          .map((c) => BigInt(c.params[0] as string))
      )
      .filter((blocks) => blocks.length > 0);
  return { history, chain, fake, cut, executions, headerPosts };
}

beforeEach(() => {
  resetRpcClients();
  resetLogCaches();
  clearCache();
  state.executedAt.clear();
  state.archiveReads = 0;
  state.network = {
    chainId: 1,
    upgradeHandler: PUH,
    upgradeHandlerDeployBlock: DEPLOY,
    blockTimeSeconds: 12,
    logCanary: { address: PUH, topic0: CANARY_TOPIC, blockNumber: DEPLOY },
    isDevNode: false,
    forkBlock: null,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("executed emergency upgrades", () => {
  it("lists every execution since deployment for the JSON list, newest first", async () => {
    const { executions, headerPosts } = await upstream();
    const list = await listEmergencyUpgrades();
    expect(list.executed.map((e) => e.id)).toEqual(
      executions.map((log) => log.topics[1]).reverse()
    );
    expect(list.executed[0]?.executed).toEqual({
      txHash: txHash(executions.at(-1) as ChainLog),
      blockNumber: (HEAD - 5n).toString(),
    });
    expect(list.executed).toHaveLength(24);
    expect(headerPosts()).toEqual([]);
  });

  it("cuts the recent window exactly where the old timestamp search did, in one header batch", async () => {
    const { executions, cut, headerPosts } = await upstream();
    // The missed slots move the cut away from a plain block count.
    expect(cut).not.toBe(HEAD - WEEK / 12n);
    const loading = await loadEmergencyList();
    const executed = await loading.executed;
    const expected = executions
      .filter((log) => log.blockNumber >= cut && log.blockNumber <= HEAD)
      .reverse();
    expect(executed.map((e) => e.id)).toEqual(expected.map((log) => log.topics[1]));
    expect(executed.map((e) => e.id)).toContain(emergencyId(2));
    expect(executed.map((e) => e.id)).not.toContain(emergencyId(1));
    expect(headerPosts()).toHaveLength(1);

    // Final headers are kept: the next read asks only for blocks above the boundary.
    const again = await (await loadEmergencyList()).executed;
    expect(again).toEqual(executed);
    const posts = headerPosts();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual([HEAD - 5n]);
  });

  it("errors instead of listing a partial history when the RPC refuses logs", async () => {
    await upstream({ override: () => new FakeRpcError(-32000, "logs are disabled") });
    await expect(listEmergencyUpgrades()).rejects.toThrow("logs are disabled");
    await expect((await loadEmergencyList()).executed).rejects.toThrow("logs are disabled");
  });

  it("lists the recent window from recent coverage alone, while the full history errors", async () => {
    // The RPC fails the oldest chunks: the backfill stops with the recent range covered.
    const deep = DEPLOY + 1_000_000n;
    const { executions, cut } = await upstream({
      override: ({ from, to }) =>
        to - from <= 10_000n && from < deep
          ? new FakeRpcError(-32000, "old blocks unavailable")
          : undefined,
    });
    await puhIndex().startBackfill();
    expect(puhIndex().status()).toMatchObject({ state: "unavailable" });
    expect(BigInt(puhIndex().status().coveredFrom ?? FINAL)).toBeLessThan(cut);
    const executed = await (await loadEmergencyList()).executed;
    expect(executed.map((e) => e.id)).toEqual(
      executions
        .filter((log) => log.blockNumber >= cut)
        .map((log) => log.topics[1])
        .reverse()
    );
    await expect(listEmergencyUpgrades()).rejects.toThrow("old blocks unavailable");
  });
});

describe("findEmergencyEvent", () => {
  it("finds an execution with no getLogs beyond the tail and no archive reads", async () => {
    const { chain, executions } = await upstream();
    await puhIndex().startBackfill();
    const before = chain.queries.length;
    const log = executions[5] as ChainLog;
    expect(await findEmergencyEvent(log.topics[1] as Hex)).toEqual({
      id: log.topics[1],
      txHash: txHash(log),
      blockNumber: log.blockNumber,
    });
    expect(chain.ranges().slice(before)).toEqual([[FINAL + 1n, HEAD]]);
    expect(state.archiveReads).toBe(0);
  });

  it("finds an execution in a block newer than the cached head", async () => {
    // Called once upgradeStatus at 'latest' says executed, which can be newer than the head the
    // index last answered at (cached for 4 s).
    const { chain } = await upstream();
    await puhIndex().startBackfill();
    await puhIndex().logs();
    const log = emergencyLog(9, HEAD + 1n);
    chain.options.logs.push(log);
    chain.options.head = { number: HEAD + 1n };
    expect(await findEmergencyEvent(emergencyId(9))).toEqual({
      id: emergencyId(9),
      txHash: txHash(log),
      blockNumber: HEAD + 1n,
    });
    expect(state.archiveReads).toBe(0);
  });

  it("uses the archive bisection only when the index is unavailable", async () => {
    const { executions } = await upstream({
      override: ({ filter }) =>
        filter.topics === undefined ? new FakeRpcError(-32000, "logs are disabled") : undefined,
    });
    const log = executions[5] as ChainLog;
    expect(await findEmergencyEvent(log.topics[1] as Hex)).toEqual({
      id: log.topics[1],
      txHash: txHash(log),
      blockNumber: log.blockNumber,
    });
    expect(puhIndex().status().state).toBe("unavailable");
    expect(state.archiveReads).toBeGreaterThan(0);
  });
});

describe("logHistory", () => {
  it("is ok when both the canary query and the complete index hold the canary", async () => {
    await upstream();
    expect(await logHistoryStatus()).toEqual({ status: "ok" });
    await puhIndex().startBackfill();
    expect(await logHistoryStatus()).toEqual({ status: "ok" });
  });

  it("is missing when the index lacks the canary the topic query returns", async () => {
    // The RPC answers the canary's own query, but its address-wide history lacks that log.
    await upstream({
      override: ({ filter, from, to }) => {
        if (filter.topics !== undefined || from > DEPLOY || to < DEPLOY) return undefined;
        const chain = state.chain as ReturnType<typeof fakeChain>;
        return chain.options.logs
          .filter((log) => log.blockNumber >= from && log.blockNumber <= to)
          .filter((log) => log.blockNumber !== DEPLOY)
          .map((log) => ({
            address: PUH.toLowerCase(),
            topics: log.topics,
            data: log.data ?? "0x",
            blockNumber: numberToHex(log.blockNumber),
            blockHash: pad(numberToHex(log.blockNumber * 1000n), { size: 32 }),
            transactionHash: txHash(log),
            transactionIndex: "0x0",
            logIndex: numberToHex(log.logIndex),
            removed: false,
          }));
      },
    });
    // Before the index is complete it has no opinion.
    expect(await logHistoryStatus()).toEqual({ status: "ok" });
    await puhIndex().startBackfill();
    expect(puhIndex().status().state).toBe("ready");
    expect(await logHistoryStatus()).toEqual({ status: "missing", blockNumber: DEPLOY.toString() });
  });
});
