import { clearCache } from "@/.server/cache";
import { IndexClosed } from "@/.server/chain/log-index";
import { IndexIntegrityError, puhIndex } from "@/.server/chain/puh-index";
import { resetRpcClients } from "@/.server/rpc";
import { type Address, type Hex, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChainLog,
  type FakeChainOptions,
  PUH_TOPICS,
  fakeChain,
  puhHistory,
} from "../support/fake-chain";
import { type FakeOptions, FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
const CANARY_TOPIC = toEventSelector("ChangeSecurityCouncil(address,address)");

const network = (overrides: Record<string, unknown> = {}) => ({
  chainId: 1,
  upgradeHandler: PUH,
  upgradeHandlerDeployBlock: DEPLOY,
  logCanary: { address: PUH, topic0: CANARY_TOPIC, blockNumber: DEPLOY },
  isDevNode: false,
  forkBlock: null,
  ...overrides,
});

const state = vi.hoisted(() => ({ network: {} as Record<string, unknown> }));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});

function upstream(
  chain: Partial<FakeChainOptions> = {},
  options: Omit<FakeOptions, "handle"> = {}
) {
  const history = puhHistory(DEPLOY, FINAL);
  const fakeChainState = fakeChain({
    address: PUH,
    logs: history.logs,
    cap: 10_000n,
    head: { number: HEAD },
    finalized: FINAL,
    ...chain,
  });
  const fake = fakeJsonRpc({ ...options, handle: (call) => fakeChainState.handle(call) });
  vi.stubGlobal("fetch", fake.fetch);
  return { history, chain: fakeChainState, fake };
}

beforeEach(() => {
  resetRpcClients();
  clearCache();
  state.network = network();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("puhIndex", () => {
  it("indexes every handler and proxy log with an address-only filter", async () => {
    const { chain, history } = upstream();
    const index = puhIndex();
    expect(index.status()).toMatchObject({ state: "idle", coveredFrom: null });
    await index.startBackfill();
    expect(index.status()).toMatchObject({
      state: "ready",
      deployBlock: DEPLOY.toString(),
      coveredFrom: DEPLOY.toString(),
      finalizedTo: FINAL.toString(),
      strategy: "chunked",
      logs: 98,
    });
    for (const query of chain.queries) {
      expect(query.filter).not.toHaveProperty("topics");
      expect(String(query.filter.address).toLowerCase()).toBe(PUH.toLowerCase());
    }
    const logs = await index.logs();
    expect(logs).toHaveLength(98);
    // The proxy's own events, which a topic filter would drop.
    expect(logs.filter((log) => log.topics[0] === PUH_TOPICS.Upgraded)).toHaveLength(3);
    expect(logs.filter((log) => log.topics[0] === PUH_TOPICS.Initialized)).toHaveLength(1);
    expect(logs.filter((log) => log.topics[0] === PUH_TOPICS.AdminChanged)).toHaveLength(1);
    expect(history.logs).toHaveLength(98);
  });

  it("decodes events, by id and from a block", async () => {
    const { history } = upstream();
    const index = puhIndex();
    const started = await index.events("UpgradeStarted");
    expect(started).toHaveLength(16);
    const first = history.upgrades[0] as (typeof history.upgrades)[number];
    expect(started[0]?.args._id).toBe(first.id);
    expect(started[0]?.args._proposal.calls[0]?.target.toLowerCase()).toBe(
      first.proposal.calls[0]?.target
    );
    expect(started[0]?.log.blockNumber).toBe(first.started);
    expect(started[0]?.log.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);

    const last = history.upgrades[15] as (typeof history.upgrades)[number];
    const recent = await index.events("UpgradeStarted", { fromBlock: last.started });
    expect(recent.map((event) => event.args._id)).toEqual([last.id]);

    const executed = await index.single("UpgradeExecuted", first.id);
    expect(executed?.log.blockNumber).toBe(first.executed);
    expect(await index.single("UpgradeExecuted", `0x${"ab".repeat(32)}`)).toBeNull();

    const emergency = history.emergencies[7] as (typeof history.emergencies)[number];
    const found = await index.single("EmergencyUpgradeExecuted", emergency.id);
    expect(found?.args._id).toBe(emergency.id);
    expect(found?.log.blockNumber).toBe(emergency.block);
    expect(await index.events("EmergencyUpgradeExecuted")).toHaveLength(20);
    expect(await index.events("UpgradeApprovedByGuardians")).toEqual([]);
  });

  it("rejects two execution events for one id", async () => {
    const history = puhHistory(DEPLOY, FINAL);
    const emergency = history.emergencies[3] as (typeof history.emergencies)[number];
    const logs: ChainLog[] = [
      ...history.logs,
      {
        blockNumber: emergency.block + 5n,
        logIndex: 4,
        topics: [PUH_TOPICS.EmergencyUpgradeExecuted, emergency.id],
      },
    ];
    upstream({ logs });
    await expect(
      puhIndex().single("EmergencyUpgradeExecuted", emergency.id)
    ).rejects.toBeInstanceOf(IndexIntegrityError);
  });

  it("reports the canary: null before coverage, true when indexed, false when missing", async () => {
    upstream();
    const index = puhIndex();
    expect(await index.hasCanary()).toBeNull();
    await index.startBackfill();
    expect(await index.hasCanary()).toBe(true);

    resetRpcClients();
    const history = puhHistory(DEPLOY, FINAL);
    upstream({ logs: history.logs.filter((log) => log.blockNumber !== DEPLOY) });
    const fresh = puhIndex();
    await fresh.startBackfill();
    expect(fresh.status().state).toBe("ready");
    expect(await fresh.hasCanary()).toBe(false);

    // A handler overridden away from the pinned one has no canary of its own.
    resetRpcClients();
    state.network = network({ upgradeHandler: "0x0000000000000000000000000000000000000abc" });
    upstream({ address: "0x0000000000000000000000000000000000000abc" });
    expect(await puhIndex().hasCanary()).toBeNull();
  });

  it("is unavailable with a scrubbed message when the RPC refuses history", async () => {
    upstream({
      override: () => new FakeRpcError(-32000, "logs disabled on http://127.0.0.1:9/secret-key"),
    });
    const index = puhIndex();
    await index.startBackfill();
    const status = index.status();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("logs disabled");
    expect(status.error).not.toContain("127.0.0.1");
    expect(status.error).not.toContain("secret-key");
  });

  it("starts over for new settings and never inserts the old generation's late results", async () => {
    upstream({}, { delayMs: 200 });
    const old = puhIndex();
    const run = old.startBackfill();
    await new Promise((r) => setTimeout(r, 10));
    resetRpcClients();
    await run;
    expect(old.status().logs).toBe(0);
    await expect(old.logs()).rejects.toBeInstanceOf(IndexClosed);

    const { chain } = upstream();
    const fresh = puhIndex();
    expect(fresh).not.toBe(old);
    expect(puhIndex()).toBe(fresh);
    expect(await fresh.logs()).toHaveLength(98);
    expect(chain.queries.length).toBeGreaterThan(400);
  });

  it("starts a fresh index when a dev node comes back at an earlier fork block", async () => {
    state.network = network({ isDevNode: true, forkBlock: DEPLOY + 1_000n, logCanary: null });
    const log: ChainLog = {
      blockNumber: DEPLOY + 900n,
      logIndex: 0,
      topics: [PUH_TOPICS.Unfreeze],
    };
    upstream({ logs: [log], cap: undefined, head: { number: DEPLOY + 1_010n } });
    expect(await puhIndex().logs()).toHaveLength(1);
    expect(puhIndex().status().finalizedTo).toBe((DEPLOY + 1_000n).toString());

    // anvil restarted at an older fork block (the refresh route clears the cached network):
    // block 900 is now a local block without the log.
    clearCache();
    state.network = network({ isDevNode: true, forkBlock: DEPLOY + 800n, logCanary: null });
    upstream({ logs: [], cap: undefined, head: { number: DEPLOY + 905n } });
    expect(await puhIndex().logs()).toEqual([]);
    expect(puhIndex().status().finalizedTo).toBe((DEPLOY + 800n).toString());
  });

  it("keeps one index per chain and handler address", async () => {
    upstream();
    const index = puhIndex();
    await index.startBackfill();
    expect(index.status().logs).toBe(98);

    const other: Address = "0x0000000000000000000000000000000000000abc";
    state.network = network({ upgradeHandler: other });
    const { chain } = upstream({
      address: other,
      logs: [{ blockNumber: FINAL - 5n, logIndex: 0, topics: [PUH_TOPICS.Unfreeze] }],
    });
    const logs = await index.logs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.address.toLowerCase()).toBe(other);
    expect(chain.queries.every((q) => String(q.filter.address).toLowerCase() === other)).toBe(true);
  });
});

it("reads ids case-insensitively", async () => {
  const { history } = upstream();
  const first = history.upgrades[0] as (typeof history.upgrades)[number];
  const upper = `0x${first.id.slice(2).toUpperCase()}` as Hex;
  expect((await puhIndex().single("UpgradeStarted", upper))?.args._id).toBe(first.id);
});
