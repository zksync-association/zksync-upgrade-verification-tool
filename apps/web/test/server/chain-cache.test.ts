import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "@/.server/cache";
import { l2GovernorIndex } from "@/.server/chain/l2-index";
import { activeL2ProposalsAnswer } from "@/.server/flows/l2";
import { IndexIncomplete } from "@/.server/chain/log-index";
import { puhIndex } from "@/.server/chain/puh-index";
import {
  chainCacheFileName,
  chainCacheStatus,
  loadChainCache,
  saveChainCache,
  stopChainCache,
} from "@/.server/persist/chain-cache";
import { blockTimestamps, l2ChainId, pageBlockTimestamps, resetRpcClients } from "@/.server/rpc";
import {
  freshListingVersion,
  heldSafeListing,
  listSafeMessages,
  peekSafeMessage,
} from "@/.server/safe/store";
import { resetSafeClient } from "@/.server/safe-api";
import { presence, resetPresence } from "@/.server/sync/presence";
import { saveLocalSettings } from "@config/local-settings.server";
import { type Address, type Hex, numberToHex, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, puhHistory } from "../support/fake-chain";
import {
  ERA_URL,
  FINAL as ERA_FINAL,
  HEAD as ERA_HEAD,
  GOVERNORS,
  fakeEra,
  proposalIdOf,
} from "../support/fake-era";
import { type FakeCall, type FakePost, fakeJsonRpc } from "../support/fake-jsonrpc";

// The chain cache (persist/chain-cache.ts): the last run's public chain and Safe data, kept in a
// file, checked against the chain at start, seeded as provisional (pages only), and verified (or
// discarded) once this run's own backfill has read the same range. It never holds a URL or a key.

const PUH: Address = "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3";
const DEPLOY = 21_788_382n;
const FINAL = 26_129_027n;
const HEAD = FINAL + 80n;
// The next run's boundary: 3,000 blocks further.
const NEXT_FINAL = FINAL + 3_000n;
const NEXT_HEAD = NEXT_FINAL + 80n;
const GENESIS: Hex = "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3";
const OTHER_GENESIS: Hex = "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9";
const SAFE_URL = "https://api.safe.global/tx-service/eth";
const SAFE_A: Address = "0x0000000000000000000000000000000000005a1a";
const SAFE_B: Address = "0x0000000000000000000000000000000000005a1b";
const CANARY_TOPIC = toEventSelector("ChangeSecurityCouncil(address,address)");
const CAP = 10_000n;

const state = vi.hoisted(() => ({ network: {} as Record<string, unknown> }));

vi.mock("@/.server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/.server/cache")>();
  return {
    ...actual,
    cached: (key: string, ttlMs: number, compute: () => Promise<unknown>) =>
      key === "network" ? Promise.resolve(state.network) : actual.cached(key, ttlMs, compute),
  };
});
// The network as read (the saver's checks use only what was read, never asking the node).
vi.mock("@/.server/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/rpc")>()),
  resolvedNetwork: () => state.network,
}));

const mainnet = (overrides: Record<string, unknown> = {}) => ({
  name: "mainnet",
  chainId: 1,
  upgradeHandler: PUH,
  upgradeHandlerDeployBlock: DEPLOY,
  logCanary: { address: PUH, topic0: CANARY_TOPIC, blockNumber: DEPLOY },
  isDevNode: false,
  forkBlock: null,
  safeTxServiceUrl: SAFE_URL,
  l2RpcUrl: null,
  l2Governors: { protocol: null, token: null, govOps: null },
  blockTimeSeconds: 12,
  overrides: [],
  clientVersion: "Geth/v1.15",
  ...overrides,
});

const message = (safe: Address, n: number) => ({
  created: "2026-10-01T10:00:00.000000Z",
  modified: `2026-10-01T10:0${n}:00.000000Z`,
  safe,
  messageHash: `0x${n.toString(16).padStart(64, "0")}`,
  message: { types: {}, primaryType: "Test", domain: {}, message: { n } },
  proposedBy: safe,
  confirmations: [{ owner: safe, signature: `0x${"11".repeat(65)}`, signatureType: "EOA" }],
  preparedSignature: `0x${"11".repeat(65)}`,
});

type Upstream = {
  /** Answers eth_chainId (default 0x1). */
  chainId?: Hex;
  genesis?: Hex;
  finalized?: bigint;
  head?: bigint;
  /** Holds POSTs with backfill chunks below this block until `release()`. */
  holdBelow?: bigint;
  /** Era (only for the L2 tests). */
  era?: ReturnType<typeof fakeEra>;
  /** Logs come without their transactionIndex (the index does not require it). */
  omitTransactionIndex?: boolean;
};

function upstream(options: Upstream = {}) {
  const history = puhHistory(DEPLOY, FINAL);
  const chain = fakeChain({
    address: PUH,
    logs: history.logs,
    cap: CAP,
    head: { number: options.head ?? HEAD },
    finalized: options.finalized ?? FINAL,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = (call: FakeCall) => {
    if (options.holdBelow === undefined || call.method !== "eth_getLogs") return false;
    const filter = call.params[0] as { fromBlock: Hex; toBlock: Hex };
    const from = BigInt(filter.fromBlock);
    const to = BigInt(filter.toBlock);
    return to - from <= CAP && from <= options.holdBelow;
  };
  const l1 = fakeJsonRpc({
    handle: (call) => {
      if (call.method === "eth_chainId") return options.chainId ?? "0x1";
      if (call.method === "eth_getBlockByNumber" && call.params[0] === "0x0")
        return {
          number: "0x0",
          hash: options.genesis ?? GENESIS,
          parentHash: `0x${"00".repeat(32)}`,
          timestamp: "0x0",
        };
      const answer = chain.handle(call);
      if (options.omitTransactionIndex && Array.isArray(answer))
        return answer.map(({ transactionIndex: _, ...log }) => log);
      return answer;
    },
    intercept: async (post: FakePost) => {
      if (post.calls.some(held)) await gate;
      return undefined;
    },
  });
  const era = options.era && fakeJsonRpc({ handle: (call) => options.era?.handle(call) });
  const safeReads: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(SAFE_URL)) {
      safeReads.push(url);
      const safe = /safes\/(0x[0-9a-fA-F]{40})\//.exec(url)?.[1] as Address;
      const messages = [message(safe, 1), message(safe, 2)];
      return Response.json({ count: messages.length, results: messages });
    }
    if (url.startsWith(ERA_URL) && era) return era.fetch(input, init);
    return l1.fetch(input, init);
  });
  return { chain, l1, history, release, safeReads };
}

/** A new process: new settings generation, empty caches, the chain cache forgotten. */
function restart(net: Record<string, unknown> = mainnet()) {
  stopChainCache();
  resetRpcClients();
  resetSafeClient();
  clearCache();
  state.network = net;
}

let dir: string;
const cacheDir = () => join(dir, ".cache", "chain");
const FILE = chainCacheFileName({ chainId: 1, genesisHash: GENESIS });
const filePath = () => join(cacheDir(), FILE);
const readFile = () => JSON.parse(readFileSync(filePath(), "utf8"));
const writeFile = (contents: unknown) => writeFileSync(filePath(), JSON.stringify(contents));

/** One run that reads the whole history, a timestamp and a Safe listing, and saves them. */
async function firstRun() {
  restart();
  const up = upstream();
  await loadChainCache({ dir: cacheDir() });
  await puhIndex().startBackfill();
  await blockTimestamps([DEPLOY + 5n]);
  await listSafeMessages(SAFE_A);
  expect(await saveChainCache()).toBe(true);
  return up;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chain-cache-"));
  restart();
});
afterEach(() => {
  stopChainCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("saving", () => {
  it("the saver's checks never ask the node: nothing is sent while the chain's identity is unknown", async () => {
    restart();
    vi.useFakeTimers();
    let sent = 0;
    // The RPC is down from the start: the identity read at load fails (and is not kept).
    vi.stubGlobal("fetch", async () => {
      sent++;
      return new Response("unavailable", { status: 503 });
    });
    await loadChainCache({ dir: cacheDir() });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toBeGreaterThan(0);
    const before = sent;
    // Ten minutes of the saver's checks (one every 10 s): nothing asked again.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent).toBe(before);
    expect(await saveChainCache({ force: false })).toBe(false);
    expect(sent).toBe(before);
  });

  it("while the app is in use, a check reads the chain's identity the start did not, and saves; idle it asks nothing", async () => {
    // PREWARM=0: the start reads nothing (the same as a failed read at start, or a settings
    // change since: no identity known for these settings).
    vi.stubEnv("PREWARM", "0");
    restart();
    resetPresence();
    const up = upstream();
    await loadChainCache({ dir: cacheDir() });
    await puhIndex().startBackfill();
    const identityReads = () =>
      up.l1.posts
        .flatMap((p) => p.calls)
        .filter(
          (c) =>
            c.method === "eth_chainId" ||
            (c.method === "eth_getBlockByNumber" && c.params[0] === "0x0")
        ).length;
    const before = identityReads();
    // Idle: the check skips without asking.
    expect(await saveChainCache({ force: false })).toBe(false);
    expect(identityReads()).toBe(before);
    expect(existsSync(filePath())).toBe(false);
    // A page load: the next check reads the identity once, and saves.
    presence().load();
    expect(await saveChainCache({ force: false })).toBe(true);
    expect(readFile().chain).toEqual({ chainId: 1, genesisHash: GENESIS });
    const read = identityReads();
    expect(read).toBeGreaterThan(before);
    // Known from now on: later checks ask nothing about it.
    await blockTimestamps([DEPLOY + 5n]);
    await saveChainCache({ force: false });
    expect(identityReads()).toBe(read);
    resetPresence();
  });

  it("writes the complete history, final timestamps and Safe listings atomically, 0600 in a 0700 directory", async () => {
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus()).toMatchObject({ state: "absent", file: null });
    // Nothing until the handler's history is complete.
    expect(await saveChainCache()).toBe(false);
    expect(existsSync(cacheDir())).toBe(false);

    await puhIndex().startBackfill();
    await blockTimestamps([DEPLOY + 5n]);
    const listing = await listSafeMessages(SAFE_A);
    expect(await saveChainCache()).toBe(true);

    expect(readdirSync(cacheDir())).toEqual([FILE]);
    expect(statSync(filePath()).mode & 0o777).toBe(0o600);
    expect(statSync(cacheDir()).mode & 0o777).toBe(0o700);
    const saved = readFile();
    expect(saved).toMatchObject({
      schema: 1,
      chain: { chainId: 1, genesisHash: GENESIS },
      puh: {
        address: PUH.toLowerCase(),
        deployBlock: numberToHex(DEPLOY),
        coveredFrom: numberToHex(DEPLOY),
        finalizedTo: numberToHex(FINAL),
      },
      l2: null,
      timestamps: {
        l1: [[numberToHex(DEPLOY + 5n), numberToHex(1_700_000_000n + (DEPLOY + 5n) * 12n)]],
        l2: [],
      },
      safe: { service: "https://api.safe.global" },
    });
    expect(saved.puh.logs).toHaveLength(98);
    expect(saved.safe.listings).toEqual([
      {
        safe: SAFE_A.toLowerCase(),
        fetchedAt: listing.fetchedAt,
        complete: true,
        messages: listing.messages,
      },
    ]);
    expect(chainCacheStatus()).toEqual({
      state: "absent",
      file: FILE,
      savedAt: saved.savedAt,
      sizeBytes: statSync(filePath()).size,
      detail: null,
    });
  });

  it("saves again only when something changed, at most once a minute (shutdown always)", async () => {
    await firstRun();
    // Unchanged: nothing to save.
    expect(await saveChainCache({ force: false })).toBe(false);
    // A new Safe listing within the minute: not yet.
    await listSafeMessages(SAFE_B);
    vi.useFakeTimers({ toFake: ["Date"] });
    expect(await saveChainCache({ force: false })).toBe(false);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await saveChainCache({ force: false })).toBe(true);
    expect(readFile().safe.listings).toHaveLength(2);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await saveChainCache({ force: false })).toBe(false);
    // On shutdown: saved whatever changed.
    expect(await saveChainCache()).toBe(true);
  });

  it("does not let a periodic check in flight swallow the shutdown save", async () => {
    await firstRun();
    await listSafeMessages(SAFE_B);
    // Within the minute: the check writes nothing; the shutdown save after it does.
    const tick = saveChainCache({ force: false });
    const shutdown = saveChainCache();
    expect(await tick).toBe(false);
    expect(await shutdown).toBe(true);
    expect(readFile().safe.listings).toHaveLength(2);
  });

  it("keeps logs an RPC answered without their transaction index, and verifies them the next start", async () => {
    restart();
    upstream({ omitTransactionIndex: true });
    await loadChainCache({ dir: cacheDir() });
    await puhIndex().startBackfill();
    expect(await saveChainCache()).toBe(true);
    expect(chainCacheStatus().detail).toBeNull();
    const saved = readFile();
    expect(saved.puh.logs).toHaveLength(98);
    expect(
      saved.puh.logs.every((l: { transactionIndex: unknown }) => l.transactionIndex === null)
    ).toBe(true);

    restart();
    upstream({ omitTransactionIndex: true, finalized: NEXT_FINAL, head: NEXT_HEAD });
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("provisional");
    await puhIndex().startBackfill();
    expect(chainCacheStatus().state).toBe("verified");
  });

  it("never writes a configured URL or key: the file names a self-hosted Safe service by a hash", async () => {
    const l1Url = "https://rpc.example.invalid/v3/s3cr3tL1KeyZZ";
    const l2Url = "https://era.example.invalid/rpc/s3cr3tL2KeyZZ";
    const safeKey = "s3cr3t-safe-api-key-zz";
    const safeUrl = "https://safe.internal.invalid/txs?token=s3cr3tSafeTokenZZ";
    saveLocalSettings({ L1_RPC_URL: l1Url, L2_RPC_URL: l2Url, SAFE_API_KEY: safeKey });
    try {
      restart(mainnet({ safeTxServiceUrl: safeUrl, overrides: ["SAFE_TX_SERVICE_URL"] }));
      upstream();
      await loadChainCache({ dir: cacheDir() });
      await puhIndex().startBackfill();
      await blockTimestamps([DEPLOY + 5n]);
      expect(await saveChainCache()).toBe(true);
      const text = readFileSync(filePath(), "utf8");
      for (const secret of [
        l1Url,
        "rpc.example.invalid",
        "s3cr3tL1KeyZZ",
        l2Url,
        "era.example.invalid",
        "s3cr3tL2KeyZZ",
        safeKey,
        safeUrl,
        "safe.internal.invalid",
        "s3cr3tSafeTokenZZ",
        "s3cr3t",
      ])
        expect(text).not.toContain(secret);
      expect(JSON.parse(text).safe.service).toMatch(/^sha256:[0-9a-f]{32}$/);
      // Nor does the status: no path, no URL.
      const status = JSON.stringify(chainCacheStatus());
      expect(status).not.toContain(dir);
      expect(status).not.toContain("s3cr3t");
    } finally {
      saveLocalSettings({ L1_RPC_URL: undefined, L2_RPC_URL: undefined, SAFE_API_KEY: undefined });
    }
  });
});

describe("the next start", () => {
  it("round-trips: seeds the history as provisional for pages, JSON waits, and the backfill verifies it", async () => {
    const first = await firstRun();
    const startedIds = first.history.upgrades.map((u) => u.id);

    restart();
    // The chain moved on: its boundary is 3,000 blocks further, and this run's backfill below
    // the saved boundary is held until the test releases it.
    const next = upstream({ finalized: NEXT_FINAL, head: NEXT_HEAD, holdBelow: FINAL });
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus()).toMatchObject({ state: "provisional", file: FILE, detail: null });

    // A page answers from the saved history (labelled), plus this run's reads above it.
    const page = await puhIndex().eventsAnswer("UpgradeStarted", { provisional: true });
    expect(page.provisional).toBe(true);
    expect(page.events.map((e) => e.args._id)).toEqual(startedIds);
    // Never kept: not final.
    expect(page.events.every((e) => e.provisional && !e.final)).toBe(true);
    expect(puhIndex().status()).toMatchObject({
      state: "backfilling",
      provisional: { state: "provisional", finalizedTo: FINAL.toString(), logs: 98 },
    });

    // JSON never answers from it: it waits for this run's backfill.
    await expect(puhIndex().events("UpgradeStarted", { waitMs: 30 })).rejects.toBeInstanceOf(
      IndexIncomplete
    );
    const strict = await puhIndex()
      .eventsAnswer("UpgradeStarted", { waitMs: 30 })
      .catch((e) => e);
    expect(strict).toBeInstanceOf(IndexIncomplete);

    // The saved timestamp stands in for pages, without a read; JSON reads the block.
    const blockReads = () =>
      next.l1.posts
        .flatMap((p) => p.calls)
        .filter(
          (c) => c.method === "eth_getBlockByNumber" && c.params[0] === numberToHex(DEPLOY + 5n)
        ).length;
    const times = await pageBlockTimestamps([DEPLOY + 5n]);
    expect(times.provisional).toBe(true);
    expect(times.times.get(DEPLOY + 5n)).toBe(1_700_000_000n + (DEPLOY + 5n) * 12n);
    expect(blockReads()).toBe(0);

    // The saved Safe listing: held for a page's first answer, labelled, never served as fresh.
    const held = heldSafeListing(SAFE_A);
    expect(held).toMatchObject({ fromLastRun: true, complete: true });
    expect(held?.fetchedAt).toBe(readFile().safe.listings[0].fetchedAt);
    expect(peekSafeMessage(SAFE_A, `0x${(1).toString(16).padStart(64, "0")}`)).toBeNull();
    expect(freshListingVersion(SAFE_A)).toBeNull();
    const reads = next.safeReads.length;
    const fresh = await listSafeMessages(SAFE_A);
    expect(next.safeReads.length).toBe(reads + 1);
    expect(fresh.fromLastRun).toBeUndefined();

    next.release();
    await puhIndex().startBackfill();
    expect(chainCacheStatus().state).toBe("verified");
    expect(puhIndex().status().provisional?.state).toBe("verified");
    const after = await puhIndex().eventsAnswer("UpgradeStarted", { provisional: true });
    expect(after.provisional).toBe(false);
    expect(after.events.map((e) => e.args._id)).toEqual(startedIds);

    // A strict read of the block confirms the saved timestamp (no mismatch).
    await blockTimestamps([DEPLOY + 5n]);
    expect(chainCacheStatus().state).toBe("verified");
  });

  it.each([
    [
      "an extra log",
      (logs: Record<string, unknown>[]) => {
        const copy = { ...logs[10], logIndex: "0x9", transactionHash: `0x${"ab".repeat(32)}` };
        return [...logs, copy];
      },
    ],
    ["a removed log", (logs: Record<string, unknown>[]) => logs.filter((_, i) => i !== 40)],
    [
      "a modified log",
      (logs: Record<string, unknown>[]) =>
        logs.map((log, i) =>
          i === 20 ? { ...log, transactionHash: `0x${"cd".repeat(32)}` } : log
        ),
    ],
  ])(
    "finds a file with %s wrong once the backfill covers it, and discards it",
    async (_, tamper) => {
      await firstRun();
      const saved = readFile();
      writeFile({ ...saved, puh: { ...saved.puh, logs: tamper(saved.puh.logs) } });

      restart();
      const next = upstream({ finalized: NEXT_FINAL, head: NEXT_HEAD, holdBelow: FINAL });
      await loadChainCache({ dir: cacheDir() });
      expect(chainCacheStatus().state).toBe("provisional");
      expect(heldSafeListing(SAFE_A)?.fromLastRun).toBe(true);

      next.release();
      await puhIndex().startBackfill();
      const status = chainCacheStatus();
      expect(status.state).toBe("mismatch");
      expect(status.detail).toContain("did not match the chain");
      await vi.waitFor(() => expect(existsSync(filePath())).toBe(false));
      // Everything seeded from it is gone: this run's index answers pages, Safe is read afresh,
      // the timestamp is read from the chain.
      expect(
        (await puhIndex().eventsAnswer("UpgradeStarted", { provisional: true })).provisional
      ).toBe(false);
      expect(heldSafeListing(SAFE_A)).toBeNull();
      expect((await pageBlockTimestamps([DEPLOY + 5n])).provisional).toBe(false);

      // This run's own data is saved in its place.
      expect(await saveChainCache()).toBe(true);
      expect(readFile().puh.logs).toHaveLength(98);
      expect(chainCacheStatus().state).toBe("mismatch");
    }
  );

  it("drops everything of a file found wrong as it is seeded (this run's history was complete first)", async () => {
    await firstRun();
    const saved = readFile();
    writeFile({ ...saved, puh: { ...saved.puh, logs: saved.puh.logs.slice(1) } });
    restart();
    upstream();
    // A slow start: this run's backfill completes before the file is loaded.
    await puhIndex().startBackfill();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("mismatch");
    // Nothing of the file is seeded after it was found wrong: the timestamp, the Safe listing.
    expect(heldSafeListing(SAFE_A)).toBeNull();
    expect((await pageBlockTimestamps([DEPLOY + 5n])).provisional).toBe(false);
    expect(puhIndex().status().provisional?.state).toBe("mismatch");
    expect(
      (await puhIndex().eventsAnswer("UpgradeStarted", { provisional: true })).provisional
    ).toBe(false);
    await vi.waitFor(() => expect(existsSync(filePath())).toBe(false));
  });

  it("lets a page's read that arrives while the file is loading wait for its seed", async () => {
    await firstRun();
    restart();
    const next = upstream({ finalized: NEXT_FINAL, head: NEXT_HEAD, holdBelow: FINAL });
    const loading = loadChainCache({ dir: cacheDir() });
    // Issued before the file is read: answered from it all the same.
    const page = await puhIndex().eventsAnswer("UpgradeStarted", { provisional: true });
    expect(page.provisional).toBe(true);
    await loading;
    next.release();
    await puhIndex().startBackfill();
    expect(chainCacheStatus().state).toBe("verified");
  });

  it("keeps what the last run read and this one did not read again in the next save", async () => {
    await firstRun();
    const saved = readFile();
    restart();
    upstream({ finalized: NEXT_FINAL, head: NEXT_HEAD });
    await loadChainCache({ dir: cacheDir() });
    await puhIndex().startBackfill();
    expect(chainCacheStatus().state).toBe("verified");
    expect(await saveChainCache()).toBe(true);
    const next = readFile();
    // The Safe listing, with the time Safe answered the last run; the timestamp.
    expect(next.safe.listings).toEqual(saved.safe.listings);
    expect(next.timestamps.l1).toEqual(saved.timestamps.l1);
    // This run's history, to its own boundary.
    expect(next.puh.finalizedTo).toBe(numberToHex(NEXT_FINAL));
  });

  it("finds a wrong saved timestamp when JSON reads the block, and discards the file", async () => {
    await firstRun();
    const saved = readFile();
    writeFile({
      ...saved,
      timestamps: { ...saved.timestamps, l1: [[numberToHex(DEPLOY + 5n), numberToHex(42n)]] },
    });
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect((await pageBlockTimestamps([DEPLOY + 5n])).times.get(DEPLOY + 5n)).toBe(42n);
    await blockTimestamps([DEPLOY + 5n]);
    expect(chainCacheStatus().state).toBe("mismatch");
    await vi.waitFor(() => expect(existsSync(filePath())).toBe(false));
  });

  it("rewrites a file this run saved when a timestamp the last run read is then contradicted", async () => {
    await firstRun();
    const saved = readFile();
    writeFile({
      ...saved,
      timestamps: { ...saved.timestamps, l1: [[numberToHex(DEPLOY + 5n), numberToHex(42n)]] },
    });
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    await puhIndex().startBackfill();
    expect(chainCacheStatus().state).toBe("verified");
    // This run saves, still with what it kept of the last run's unchecked: the timestamp and the
    // Safe listing it has not read again.
    expect(await saveChainCache({ force: false })).toBe(true);
    expect(readFile().timestamps.l1).toEqual([[numberToHex(DEPLOY + 5n), numberToHex(42n)]]);
    expect(readFile().safe.listings).toHaveLength(1);
    // A read of the block contradicts it: the file is saved again at once, without anything of
    // the last run's.
    await blockTimestamps([DEPLOY + 5n]);
    expect(chainCacheStatus().state).toBe("mismatch");
    await vi.waitFor(() =>
      expect(readFile().timestamps.l1).toEqual([
        [numberToHex(DEPLOY + 5n), numberToHex(1_700_000_000n + (DEPLOY + 5n) * 12n)],
      ])
    );
    expect(readFile().safe.listings).toEqual([]);
    expect(readFile().puh.logs).toHaveLength(98);
  });

  it.each([
    ["an hour", 60 * 60_000],
    ["four minutes", 4 * 60_000],
  ])("leaves out a Safe listing the file says Safe answered %s from now", async (_, ahead) => {
    await firstRun();
    const saved = readFile();
    const future = Date.now() + ahead;
    writeFile({
      ...saved,
      safe: { ...saved.safe, listings: [{ ...saved.safe.listings[0], fetchedAt: future }] },
    });
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("provisional");
    expect(heldSafeListing(SAFE_A)).toBeNull();
  });

  it.each([
    ["another genesis block", { genesis: OTHER_GENESIS }, "No cache for this chain."],
    ["another chain id", { chainId: "0xaa36a7" as Hex }, "No cache for this chain."],
  ])("ignores the file when the RPC serves %s", async (_, rpc, detail) => {
    await firstRun();
    restart();
    upstream(rpc);
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus()).toMatchObject({ state: "absent", file: null, detail });
    expect(heldSafeListing(SAFE_A)).toBeNull();
    await puhIndex().startBackfill();
    expect(puhIndex().status().provisional).toBeNull();
  });

  it.each([
    ["not JSON", () => "{ not json", "not valid JSON"],
    [
      "content naming another chain than its name",
      (s: { chain: Record<string, unknown> }) => ({
        ...s,
        chain: { ...s.chain, genesisHash: OTHER_GENESIS },
      }),
      "The cache file is for another chain; it was ignored.",
    ],
    [
      "another schema version",
      (s: Record<string, unknown>) => ({ ...s, schema: 2 }),
      "expected format",
    ],
    [
      "an unknown field",
      (s: Record<string, unknown>) => ({ ...s, rpcUrl: "x" }),
      "expected format",
    ],
    [
      "a log outside its range",
      (s: { puh: { logs: Record<string, unknown>[] } }) => ({
        ...s,
        puh: {
          ...s.puh,
          logs: [...s.puh.logs, { ...s.puh.logs[3], blockNumber: numberToHex(FINAL + 1n) }],
        },
      }),
      "does not accept",
    ],
    [
      "blocks beyond the chain's head",
      (s: { puh: Record<string, unknown> }) => ({
        ...s,
        puh: { ...s.puh, finalizedTo: numberToHex(HEAD + 1_000n) },
      }),
      "beyond the chain's head",
    ],
    [
      "an incomplete history",
      (s: { puh: Record<string, unknown> }) => ({
        ...s,
        puh: { ...s.puh, coveredFrom: numberToHex(DEPLOY + 1n) },
      }),
      "does not accept",
    ],
    [
      "a malformed Safe message",
      (s: { safe: { listings: { messages: unknown[] }[] } }) => ({
        ...s,
        safe: { ...s.safe, listings: [{ ...s.safe.listings[0], messages: [{ nope: true }] }] },
      }),
      "expected format",
    ],
  ])("ignores a file with %s, without failing", async (_, change, detail) => {
    await firstRun();
    const saved = readFile();
    const changed = (change as (s: never) => unknown)(saved as never);
    writeFileSync(filePath(), typeof changed === "string" ? changed : JSON.stringify(changed));
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("absent");
    expect(chainCacheStatus().detail).toContain(detail);
    expect(heldSafeListing(SAFE_A)).toBeNull();
    await puhIndex().startBackfill();
    expect(puhIndex().status()).toMatchObject({ state: "ready", provisional: null });
    // And this run saves a good one over it.
    expect(await saveChainCache()).toBe(true);
    expect(readFile().puh.logs).toHaveLength(98);
  });

  it("never reads or writes on a dev node", async () => {
    await firstRun();
    const before = readFileSync(filePath(), "utf8");
    restart(mainnet({ isDevNode: true, forkBlock: FINAL }));
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("disabled");
    expect(heldSafeListing(SAFE_A)).toBeNull();
    expect(await saveChainCache()).toBe(false);
    expect(readFileSync(filePath(), "utf8")).toBe(before);
  });

  it("is off with CHAIN_CACHE=0: nothing read, nothing written", async () => {
    await firstRun();
    const before = readFileSync(filePath(), "utf8");
    vi.stubEnv("CHAIN_CACHE", "0");
    restart();
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus()).toMatchObject({ state: "disabled", detail: "CHAIN_CACHE=0" });
    expect(heldSafeListing(SAFE_A)).toBeNull();
    await puhIndex().startBackfill();
    expect(puhIndex().status().provisional).toBeNull();
    expect(await saveChainCache()).toBe(false);
    expect(readFileSync(filePath(), "utf8")).toBe(before);
  });

  it("ignores a saved history for another ProtocolUpgradeHandler", async () => {
    await firstRun();
    restart(mainnet({ upgradeHandler: "0x0000000000000000000000000000000000000bad" }));
    upstream();
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus()).toMatchObject({
      state: "absent",
      detail: "The cache file is for another ProtocolUpgradeHandler; it was ignored.",
    });
    expect(heldSafeListing(SAFE_A)).toBeNull();
    await puhIndex().startBackfill();
    expect(puhIndex().status().provisional).toBeNull();
  });
});

describe("the L2 governors' history", () => {
  const ERA_MAINNET = () =>
    mainnet({
      l2RpcUrl: ERA_URL,
      l2Governors: { ...GOVERNORS },
    });
  const proposals = () => [
    {
      governor: GOVERNORS.token,
      description: "first",
      created: 49_077_771n,
      executed: 49_477_771n,
      state: 7,
    },
    { governor: GOVERNORS.govOps, description: "second", created: ERA_FINAL - 9_000n, state: 1 },
  ];
  /** Era whose backfill waits for `release()`; its tail is answered. */
  const heldEra = (list: Parameters<typeof fakeEra>[0]) => {
    const era = fakeEra(list);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = {
      ...era,
      handle: async (call: FakeCall) => {
        const filter = call.params[0] as { toBlock?: Hex };
        if (call.method === "eth_getLogs" && BigInt(filter.toBlock ?? "0x0") <= ERA_FINAL)
          await gate;
        return era.handle(call);
      },
    };
    return { era: held as unknown as ReturnType<typeof fakeEra>, release };
  };

  it("is saved with Era's chain id and seeded, then verified, on the next start", async () => {
    restart(ERA_MAINNET());
    upstream({ era: fakeEra(proposals()) });
    await loadChainCache({ dir: cacheDir() });
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    await l2GovernorIndex().read();
    expect(await saveChainCache()).toBe(true);
    const saved = readFile();
    expect(saved.l2).toMatchObject({ l2ChainId: 0x144, addresses: expect.any(Array) });
    expect(saved.l2.addresses).toHaveLength(3);
    expect(saved.l2.topic0).toHaveLength(3);
    expect(saved.l2.logs).toHaveLength(3);

    restart(ERA_MAINNET());
    upstream({ era: fakeEra(proposals()) });
    await loadChainCache({ dir: cacheDir() });
    expect(chainCacheStatus().state).toBe("provisional");
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    await vi.waitFor(() => expect(chainCacheStatus().state).toBe("verified"));
    expect(l2GovernorIndex().status().provisional?.state).toBe("verified");
  });

  it("is decoded for a page's answer only: what a seeded log says is never kept for this run's", async () => {
    restart(ERA_MAINNET());
    upstream({ era: fakeEra(proposals()) });
    await loadChainCache({ dir: cacheDir() });
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    await l2GovernorIndex().read();
    expect(await saveChainCache()).toBe(true);
    const saved = readFile();
    // The first proposal's creation, at its place in the chain, says what the second's does.
    const [first, ...rest] = saved.l2.logs;
    const second = rest[rest.length - 1];
    writeFile({ ...saved, l2: { ...saved.l2, logs: [{ ...first, data: second.data }, ...rest] } });

    restart(ERA_MAINNET());
    const { era, release } = heldEra(proposals());
    upstream({ era });
    await loadChainCache({ dir: cacheDir() });
    const backfill = l2GovernorIndex().startBackfill();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const page = await l2GovernorIndex().read({ provisional: true });
    expect(page.provisional).toBe(true);
    expect(page.events[0]?.proposalId).toBe(proposalIdOf("second"));
    release();
    await backfill;
    await puhIndex().startBackfill();
    await vi.waitFor(() => expect(chainCacheStatus().state).toBe("mismatch"));
    const strict = await l2GovernorIndex().read();
    expect(strict.events[0]?.proposalId).toBe(proposalIdOf("first"));
  });

  it("answers a page's vetoable list, labelled, and never keeps what a seeded log says", async () => {
    const vetoable = () => [
      ...proposals(),
      { governor: GOVERNORS.govOps, description: "third", created: ERA_FINAL - 8_000n, state: 1 },
    ];
    restart(ERA_MAINNET());
    upstream({ era: fakeEra(vetoable()) });
    await loadChainCache({ dir: cacheDir() });
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    expect((await activeL2ProposalsAnswer()).proposals.map((p) => p.description)).toEqual([
      "second",
      "third",
    ]);
    expect(await saveChainCache()).toBe(true);
    const saved = readFile();
    // "second"'s creation, at its place in the chain, says what "third"'s does.
    const logs = saved.l2.logs as { data: Hex }[];
    const [second, third] = logs.slice(-2) as [{ data: Hex }, { data: Hex }];
    writeFile({
      ...saved,
      l2: { ...saved.l2, logs: [...logs.slice(0, -2), { ...second, data: third.data }, third] },
    });

    restart(ERA_MAINNET());
    const { era, release } = heldEra(vetoable());
    upstream({ era });
    await loadChainCache({ dir: cacheDir() });
    const backfill = l2GovernorIndex().startBackfill();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A page: what the saved history says, labelled as such; states are read now.
    const page = await activeL2ProposalsAnswer({ provisional: true });
    expect(page.provisional).toBe(true);
    expect(page.proposals.map((p) => p.description)).toEqual(["third", "third"]);
    expect(page.proposals.every((p) => p.state === "Active")).toBe(true);
    release();
    await backfill;
    // This run's list: the chain's history, with nothing kept from what the saved log said.
    const strict = await activeL2ProposalsAnswer();
    expect(strict.provisional).toBe(false);
    expect(strict.proposals.map((p) => p.description)).toEqual(["second", "third"]);
    expect(strict.proposals[0]?.proposalId).toBe(proposalIdOf("second").toString());
  });

  it.each([
    [
      "it claims Era blocks beyond Era's head",
      (l2: Record<string, unknown>) => ({ ...l2, finalizedTo: numberToHex(ERA_HEAD + 1_000n) }),
    ],
    ["Era answers another chain id", (l2: Record<string, unknown>) => ({ ...l2, l2ChainId: 300 })],
  ])("is not seeded when %s", async (_, tamper) => {
    restart(ERA_MAINNET());
    upstream({ era: fakeEra(proposals()) });
    await loadChainCache({ dir: cacheDir() });
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    await l2GovernorIndex().read();
    expect(await saveChainCache()).toBe(true);
    const saved = readFile();
    writeFile({ ...saved, l2: tamper(saved.l2) });

    restart(ERA_MAINNET());
    upstream({ era: fakeEra(proposals()) });
    await loadChainCache({ dir: cacheDir() });
    await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
    await vi.waitFor(() => expect(chainCacheStatus().state).toBe("verified"));
    expect(l2GovernorIndex().status().provisional).toBeNull();
  });

  it.each(["found wrong", "stopped"] as const)(
    "is not seeded when Era answers after the cache was %s",
    async (end) => {
      restart(ERA_MAINNET());
      upstream({ era: fakeEra(proposals()) });
      await loadChainCache({ dir: cacheDir() });
      await Promise.all([puhIndex().startBackfill(), l2GovernorIndex().startBackfill()]);
      await l2GovernorIndex().read();
      await blockTimestamps([DEPLOY + 5n]);
      expect(await saveChainCache()).toBe(true);
      const saved = readFile();
      expect(saved.l2.logs).toHaveLength(3);
      // The saved L1 timestamp is wrong.
      writeFile({
        ...saved,
        timestamps: { ...saved.timestamps, l1: [[numberToHex(DEPLOY + 5n), numberToHex(42n)]] },
      });

      restart(ERA_MAINNET());
      // Era answers its chain id, and its history below its boundary, only when the test lets it.
      const era = fakeEra(proposals());
      let answer!: () => void;
      const idGate = new Promise<void>((resolve) => {
        answer = resolve;
      });
      let release!: () => void;
      const logGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = {
        ...era,
        handle: async (call: FakeCall) => {
          if (call.method === "eth_chainId") await idGate;
          const filter = call.params[0] as { toBlock?: Hex };
          if (call.method === "eth_getLogs" && BigInt(filter.toBlock ?? "0x0") <= ERA_FINAL)
            await logGate;
          return era.handle(call);
        },
      };
      upstream({ era: slow as unknown as ReturnType<typeof fakeEra> });
      await loadChainCache({ dir: cacheDir() });
      expect(chainCacheStatus().state).toBe("provisional");
      const backfill = l2GovernorIndex().startBackfill();
      if (end === "found wrong") {
        // A read of the block contradicts the saved timestamp: the file is dropped.
        await blockTimestamps([DEPLOY + 5n]);
        expect(chainCacheStatus().state).toBe("mismatch");
        await vi.waitFor(() => expect(existsSync(filePath())).toBe(false));
      } else stopChainCache();
      // Only now does Era answer its chain id (and what waited on it runs).
      answer();
      expect(await l2ChainId()).toBe(0x144);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(l2GovernorIndex().status().provisional).toBeNull();
      release();
      await backfill;
      expect(l2GovernorIndex().status().provisional).toBeNull();
      expect((await l2GovernorIndex().read({ provisional: true })).provisional).toBe(false);
      if (end === "found wrong") expect(chainCacheStatus().state).toBe("mismatch");
    }
  );
});
