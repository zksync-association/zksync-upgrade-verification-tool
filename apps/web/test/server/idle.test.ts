import { clearCache } from "@/.server/cache";
import { puhIndex } from "@/.server/chain/puh-index";
import { appStatus } from "@/.server/status";
import { listStandardUpgrades } from "@/.server/flows/standard";
import { resetRpcClients } from "@/.server/rpc";
import { type SignatureSetParams, watchSignatureSet } from "@/.server/signatures";
import { noteRequest, stopSync, syncEngineStatus, wakeSync } from "@/.server/sync/engine";
import { type RequestInfo, presence, resetPresence } from "@/.server/sync/presence";
import { buildTypedData } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { numberToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockHash, puhHistory } from "../support/fake-chain";
import { fakeEra } from "../support/fake-era";
import { type FakePost, fakeJsonRpc } from "../support/fake-jsonrpc";
import { L1, SC_MEMBERS, type UpgradeOnChain, fakeL1 } from "../support/fake-l1";

// Nobody using the app means no upstream request at all (plan D1, decision 1): once the last tab
// stopped beating (or the last page load's grace ended), the engine stops at its next wake, and
// nothing (head polls, ticks, the Safe sweep, Era, retries, the chain cache's saver) sends
// anything until the next use, however long that takes and whatever fails meanwhile. JSON and
// prefetches never start it; a page load or a tab's beat does. The first use after a pause reads
// each thing once: one head read shared by the request and the engine, governance in one round.

vi.mock("@/.server/safe-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/safe-api")>()),
  // As with SAFE_API_KEY: the Safe store's sweep reads in the background (here: while in use).
  backgroundSafeReadsAllowed: () => true,
}));

const NOW = 1_800_000_000_000;
const HEAD = 26_129_107n;
const FINAL = HEAD - 80n;
const HEAD_TIME = BigInt(Math.floor(NOW / 1000)) - 1n;
const L1_URL = process.env.L1_RPC_URL ?? "http://127.0.0.1:9";
const KEEPWARM_MS = 30_000;

type Kind = "l1" | "l2" | "safe";
type Sent = { at: number; kind: Kind };

/**
 * Mainnet-like L1, Era and Safe behind one fetch stub, counting what is sent to each. Each L1 POST
 * takes `latencyMs` (a real RPC: 130-440 ms a round).
 */
function world({ latencyMs = 0 }: { latencyMs?: number } = {}) {
  const history = puhHistory(L1.deployBlock, FINAL - 1_000n);
  const upgrades = new Map<string, UpgradeOnChain>();
  for (const upgrade of history.upgrades)
    upgrades.set(upgrade.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [1_700_000_000, 1_700_000_100, false, false, true],
    });
  const l1 = fakeL1({
    head: { number: HEAD, hash: blockHash(HEAD), timestamp: HEAD_TIME },
    finalized: FINAL,
    logs: history.logs,
    upgrades,
    delayMs: latencyMs,
  });
  const era = fakeEra([]);
  const eraRpc = fakeJsonRpc({ handle: (call) => era.handle(call) });
  const sent: Sent[] = [];
  const failing = { on: false };
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const kind: Kind = url.startsWith("https://api.safe.global/")
      ? "safe"
      : url.startsWith(L1_URL)
        ? "l1"
        : "l2";
    sent.push({ at: Date.now(), kind });
    if (failing.on)
      return kind === "safe"
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "1" } })
        : new Response("unavailable", { status: 503 });
    if (kind === "safe") return Response.json({ count: 0, results: [] });
    return (kind === "l1" ? l1 : eraRpc).fetch(input, init);
  });
  /** Moves the chain to block `n` (12 s a block from HEAD). */
  const produce = (n: bigint) => {
    l1.chain.options.head = {
      number: n,
      hash: blockHash(n),
      timestamp: HEAD_TIME + (n - HEAD) * 12n,
    };
    l1.chain.options.finalized = n - 80n;
  };
  return { l1, era, eraRpc, sent, failing, produce, history };
}

/** Runs the fake clock in small steps until `done`. */
async function until(done: () => boolean, maxMs = 10_000) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > maxMs) throw new Error("timed out waiting");
    await vi.advanceTimersByTimeAsync(10);
  }
}

/** Runs the fake clock until `promise` settles, and returns its value. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  void tracked.catch(() => {});
  await until(() => done, 20_000);
  return tracked;
}

const page = (path: string, headers: Record<string, string> = {}): RequestInfo => ({
  method: "GET",
  path,
  header: (name) => headers[name],
});

/** The Security Council's approval set of an upgrade, as its page registers it. */
const councilSet = (): SignatureSetParams => ({
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup: "securityCouncil",
  typedData: buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: L1.securityCouncil },
    { id: `0x${"ab".repeat(32)}` }
  ),
  members: [...SC_MEMBERS],
  threshold: 2,
  check: { kind: "multisig", contract: L1.securityCouncil },
  open: true,
});

/** A visible tab beats with these keys. */
const beat = (keys: string[], tab = "tab-under-test-1") =>
  presence().beat({ tab, reason: "interval", items: keys.map((key) => ({ key, rev: null })) });

async function backfilled() {
  const index = puhIndex();
  void index.startBackfill();
  await until(() => index.status().state === "ready");
}

const sentAfter = (sent: Sent[], at: number, kind?: Kind) =>
  sent.filter((s) => s.at > at && (kind === undefined || s.kind === kind));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetPresence({ keepWarmMs: KEEPWARM_MS });
});

afterEach(() => {
  stopSync();
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("I-1: nobody uses the app", () => {
  it("sends nothing upstream for 6 h after the last beat's keep-warm and one wake, every upstream failing", async () => {
    const w = world();
    await backfilled();
    // A page load, then its tab beats: the council's set and the vetoable list on screen.
    noteRequest(page("/app/proposals/0xab"));
    const set = watchSignatureSet(councilSet());
    beat(["status", "upgrade:0xab", set.key, "list:vetoes"]);
    await until(() => syncEngineStatus().ticks >= 1);
    // In use for a while, a block arriving meanwhile: the head is followed, the set's member
    // Safes swept, Era followed.
    let lastBeat = Date.now();
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      lastBeat = Date.now();
      beat(["status", "upgrade:0xab", set.key, "list:vetoes"]);
    }
    w.produce(HEAD + 1n);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentAfter(w.sent, NOW, "l1").length).toBeGreaterThan(0);
    expect(sentAfter(w.sent, NOW, "safe").length).toBeGreaterThan(0);
    expect(sentAfter(w.sent, NOW, "l2").length).toBeGreaterThan(0);
    expect(syncEngineStatus()).toMatchObject({ active: true, cost: { mode: "viewing" } });

    // The tab stops beating (closed without a leave). From the keep-warm's end, every upstream
    // fails; one wake later (at most 2 s) the engine has stopped.
    await vi.advanceTimersByTimeAsync(lastBeat + KEEPWARM_MS - Date.now());
    w.failing.on = true;
    const cut = lastBeat + KEEPWARM_MS + 2_000;
    for (let hour = 0; hour < 6; hour++) {
      for (let minute = 0; minute < 60; minute++) {
        w.produce(HEAD + 2n + BigInt(hour * 300 + minute * 5));
        await vi.advanceTimersByTimeAsync(60_000);
      }
    }
    expect(sentAfter(w.sent, cut, "l1")).toEqual([]);
    expect(sentAfter(w.sent, cut, "l2")).toEqual([]);
    expect(sentAfter(w.sent, cut, "safe")).toEqual([]);
    expect(syncEngineStatus()).toMatchObject({ active: false, cost: { mode: "idle" } });
    expect(presence().status()).toMatchObject({ inUse: false, tabs: 0 });
  });
});

describe("I-2: what starts the engine", () => {
  it("never a prefetch, /api/status, /api/*, a cross-site page load or a cross-origin beat; a same-origin beat does", async () => {
    const w = world();
    await backfilled();
    const before = w.sent.length;
    for (const request of [
      page("/app/emergency", { "sec-purpose": "prefetch" }),
      page("/api/status"),
      page("/api/upgrades"),
      { ...page("/api/emergency/0xab"), method: "POST" },
      // Safe{Wallet}'s frame loading the app: a cross-site document load.
      page("/", { "sec-fetch-site": "cross-site" }),
    ])
      noteRequest(request);
    const { action } = await import("@/routes/resources+/presence");
    const beatFrom = (headers: Record<string, string>) =>
      action({
        request: new Request("http://localhost:3105/resources/presence", {
          method: "POST",
          headers,
          body: JSON.stringify({
            tab: "framed-tab-0001",
            reason: "load",
            items: [{ key: "status", rev: null }],
          }),
        }),
        params: {},
        context: {},
      } as never) as Promise<Response>;
    // Another site's page: refused.
    const refused = await beatFrom({
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });
    expect(refused.status).toBe(403);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncEngineStatus()).toMatchObject({ active: false, polls: 0 });
    expect(w.sent.length).toBe(before);

    // The framed app's own first beat (same origin as the app, inside the frame) starts it.
    const accepted = await beatFrom({
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    });
    expect(accepted.status).toBe(200);
    await until(() => syncEngineStatus().ticks >= 1);
    expect(syncEngineStatus()).toMatchObject({ active: true, cost: { mode: "viewing" } });
  });
});

describe("I-3: the first use after an hour's pause", () => {
  it("reads the head once for the request and the engine, governance in one round, the missed blocks in one read", async () => {
    const w = world({ latencyMs: 150 });
    await backfilled();
    // In use once: the engine ticks; a page reads the status (governance in rounds, the first
    // read of this process) and the list.
    noteRequest(page("/"));
    await settle(Promise.all([appStatus(), listStandardUpgrades({ allHistory: false })]));
    await until(() => syncEngineStatus().ticks >= 1);
    // An hour without use: 300 blocks.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(syncEngineStatus().active).toBe(false);
    const gapTo = HEAD + 300n;
    w.produce(gapTo);
    const from = w.l1.posts.length;
    const calls = () => w.l1.posts.slice(from).flatMap((p) => p.calls);

    // The page load wakes the engine; its loaders read the status and the list meanwhile.
    noteRequest(page("/"));
    const [status, list] = await settle(
      Promise.all([appStatus(), listStandardUpgrades({ allHistory: false })])
    );
    expect(status.ok).toBe(true);
    expect(Array.isArray(list.upgrades)).toBe(true);
    await until(() => syncEngineStatus().head?.number === gapTo.toString());
    const observedAt = Date.parse(syncEngineStatus().head?.observedAt ?? "");
    await vi.advanceTimersByTimeAsync(2_500);

    // One head read ('latest' with 'finalized') for the request and the engine together, up to
    // the engine's first sight of the new head (after it, the follower polls on its schedule).
    const latest = w.l1.posts
      .slice(from)
      .filter((p) => p.startedAt <= observedAt)
      .flatMap((p) => p.calls)
      .filter((c) => c.method === "eth_getBlockByNumber" && c.params[0] === "latest");
    expect(latest).toHaveLength(1);
    // Governance in one round: one POST of four entries, the handler's code among them.
    const governancePosts = w.l1.posts
      .slice(from)
      .filter((p) =>
        p.calls.some(
          (c) =>
            c.method === "eth_getCode" &&
            String(c.params[0]).toLowerCase() === L1.upgradeHandler.toLowerCase()
        )
      );
    expect(governancePosts).toHaveLength(1);
    expect((governancePosts[0] as FakePost).calls).toHaveLength(4);
    expect(w.l1.calls.filter((c) => c.functionName === "securityCouncil")).toHaveLength(2);
    // The missed blocks in one tail read (the provider has no range cap here), shared by the
    // list and the engine; the other read is the log-history canary (its 10 minutes are up).
    const logs = calls().filter((c) => c.method === "eth_getLogs");
    const tails = logs.filter((c) => {
      const filter = c.params[0] as { topics?: unknown; toBlock?: string };
      return filter.topics === undefined && filter.toBlock === numberToHex(gapTo);
    });
    expect(tails).toHaveLength(1);
    expect(logs.length - tails.length).toBeLessThanOrEqual(1);
    // Each upgrade's state at the new head read once (request and engine share the reads).
    const states = w.l1.calls.filter(
      (c) => c.functionName === "upgradeState" && c.block === numberToHex(gapTo)
    );
    const ids = states.map((c) => String(c.args[0]).toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    // No Era: nothing on screen shows it.
    expect(sentAfter(w.sent, NOW + 60 * 60_000, "l2")).toEqual([]);
  });

  it("woken by a tab's beat alone (no request): the head read once, governance in one round at it", async () => {
    const w = world({ latencyMs: 150 });
    await backfilled();
    // In use once (governance read in rounds, the first read of this process).
    noteRequest(page("/"));
    await settle(appStatus());
    await until(() => syncEngineStatus().ticks >= 1);
    // An hour without use: 300 blocks; nothing of the last use is still in memory.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(syncEngineStatus().active).toBe(false);
    const gapTo = HEAD + 300n;
    w.produce(gapTo);
    const from = w.l1.posts.length;

    // The tab is visible again: its beat (as POST /resources/presence records it) and nothing
    // else. The engine reads the head and starts a tick at it.
    beat(["status"]);
    wakeSync();
    await until(() => syncEngineStatus().head?.servedAt != null);
    await until(() => syncEngineStatus().ticks >= 2);
    const served = Date.parse(syncEngineStatus().head?.servedAt ?? "");
    const posts = w.l1.posts.slice(from).filter((p) => p.startedAt <= served);
    const heads = (tag: string) =>
      posts
        .flatMap((p) => p.calls)
        .filter((c) => c.method === "eth_getBlockByNumber" && c.params[0] === tag);
    // One head read ('latest' with 'finalized') up to the head being served: the engine's own.
    expect(heads("latest")).toHaveLength(1);
    expect(heads("finalized")).toHaveLength(1);
    // Governance in one round (one POST of four entries), pinned to that head.
    const governancePosts = posts.filter((p) =>
      p.calls.some(
        (c) =>
          c.method === "eth_getCode" &&
          String(c.params[0]).toLowerCase() === L1.upgradeHandler.toLowerCase()
      )
    );
    expect(governancePosts).toHaveLength(1);
    expect((governancePosts[0] as FakePost).calls).toHaveLength(4);
    expect(
      w.l1.calls.filter((c) => c.functionName === "securityCouncil").map((c) => c.block)
    ).toContain(numberToHex(gapTo));
    expect(syncEngineStatus().head?.number).toBe(gapTo.toString());
  });
});
