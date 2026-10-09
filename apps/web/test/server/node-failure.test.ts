import { clearCache } from "@/.server/cache";
import { puhIndex } from "@/.server/chain/puh-index";
import { resetRpcClients } from "@/.server/rpc";
import { type SafeMessage, resetSafeClient } from "@/.server/safe-api";
import { stopSync } from "@/.server/sync/engine";
import { resetPresence } from "@/.server/sync/presence";
import { type UpgradeProposal, encodeUpgradeProposal, upgradeProposalId } from "@/common/proposal";
import { safeMessageHashes } from "@/common/safe";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { loader } from "@/routes/api+/upgrades.$id";
import { type Hex, numberToHex, pad, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainLog, PUH_TOPICS, blockHash, puhHistory } from "../support/fake-chain";
import { fakeEra } from "../support/fake-era";
import { FakeRpcError, fakeJsonRpc } from "../support/fake-jsonrpc";
import { L1, SC_MEMBERS, type UpgradeOnChain, fakeL1 } from "../support/fake-l1";

// A node that fails to answer one read for a moment (Infura's -32603 "Internal error" for reads
// pinned to a block it just named) must not fail a JSON answer: the read is asked again, and the
// answer is the one a node without the failure gives. A failure is never a verdict either way.

const NOW = 1_800_000_000_000;
const HEAD = 26_129_107n;
const FINAL = HEAD - 80n;
const HEAD_TIME = BigInt(Math.floor(NOW / 1000)) - 1n;
const L1_URL = process.env.L1_RPC_URL ?? "http://127.0.0.1:9";

const ACTIVE: UpgradeProposal = {
  calls: [{ target: `0x${"0a".repeat(20)}`, value: "0", data: "0x" }],
  executor: zeroAddress,
  salt: pad(numberToHex(0xfa11ed), { size: 32 }) as Hex,
};
const ACTIVE_ID = upgradeProposalId(ACTIVE);
const ACTIVE_STARTED = FINAL - 500n;
const CREATED = Number(1_700_000_000n + ACTIVE_STARTED * 12n);

/**
 * Mainnet-like L1 with the active upgrade waiting for the Security Council, two of whose three
 * members signed in Safe; Era and Safe behind the same fetch stub. The node answers -32603
 * "Internal error" to the direct head-pinned calls named in `failOnce` the first time each is
 * asked, and to those in `failAlways` every time.
 */
function world({
  failOnce = [],
  failAlways = [],
}: { failOnce?: string[]; failAlways?: string[] } = {}) {
  const history = puhHistory(L1.deployBlock, FINAL - 1_000n);
  const started: ChainLog = {
    blockNumber: ACTIVE_STARTED,
    logIndex: 0,
    topics: [PUH_TOPICS.UpgradeStarted, ACTIVE_ID],
    data: encodeUpgradeProposal(ACTIVE),
  };
  const upgrades = new Map<string, UpgradeOnChain>();
  for (const upgrade of history.upgrades)
    upgrades.set(upgrade.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [1_700_000_000, 1_700_000_100, false, false, true],
    });
  upgrades.set(ACTIVE_ID.toLowerCase(), {
    state: UPGRADE_STATES.Waiting,
    status: [CREATED, 0, false, false, false],
  });
  const signatures = new Set<string>();
  const pending = new Set(failOnce);
  const failed: string[] = [];
  const l1 = fakeL1({
    head: { number: HEAD, hash: blockHash(HEAD), timestamp: HEAD_TIME },
    finalized: FINAL,
    logs: [...history.logs, started],
    upgrades,
    signatures,
    inject: (call) => {
      if (call.viaMulticall || call.block !== numberToHex(HEAD)) return undefined;
      if (!pending.delete(call.functionName) && !failAlways.includes(call.functionName))
        return undefined;
      failed.push(call.functionName);
      return new FakeRpcError(-32603, "Internal error");
    },
  });
  const era = fakeEra([]);
  const eraRpc = fakeJsonRpc({ handle: (call) => era.handle(call) });

  // The council's approval of the active upgrade, signed in Safe by its first two members.
  const typedData = buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: L1.securityCouncil },
    { id: ACTIVE_ID }
  );
  const { digest } = governanceHashes(typedData);
  const listings = new Map<string, SafeMessage[]>();
  for (const member of SC_MEMBERS.slice(0, 2)) {
    const at = new Date(NOW - 3_600_000).toISOString();
    const confirmation = { owner: zeroAddress, signature: "0x01" as Hex, signatureType: "EOA" };
    listings.set(member.toLowerCase(), [
      {
        created: at,
        modified: at,
        safe: member,
        messageHash: safeMessageHashes(1, member, digest).safeMessageHash,
        message: {},
        confirmations: [confirmation, confirmation],
        preparedSignature: "0x01",
      },
    ]);
    signatures.add(`${member}:0x01`.toLowerCase());
  }

  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.safe.global/")) {
      const safe = /\/safes\/(0x[0-9a-fA-F]{40})\/messages\//.exec(url)?.[1]?.toLowerCase();
      const results = (safe && listings.get(safe)) || [];
      return Response.json({ count: results.length, results });
    }
    return url.startsWith(L1_URL) ? l1.fetch(input, init) : eraRpc.fetch(input, init);
  });
  return { l1, failed };
}

/** Runs the fake clock in small steps until `done`. */
async function until(done: () => boolean, maxMs = 20_000) {
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
  await until(() => done);
  return tracked;
}

/** GET /api/upgrades/<id>, as `curl` sends it (AGENTS.md), after the boot warm-up's backfill. */
async function detail() {
  const index = puhIndex();
  void index.startBackfill();
  await until(() => index.status().state === "ready");
  const request = new Request(`http://localhost:3000/api/upgrades/${ACTIVE_ID}`);
  const response = (await settle(
    Promise.resolve(loader({ params: { id: ACTIVE_ID }, request, context: {} }))
  )) as Response;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type JsonSet = {
  key: string;
  state: { status: string };
  set: {
    verifiedAtBlock: string;
    thresholdCheck: { status: string };
    members: { member: string; status: string; source: string | null }[];
  };
};

/** What a signer reads from the answer: every set's state, members' verdicts, threshold check. */
const verdicts = (body: Record<string, unknown>) =>
  (body.sets as JsonSet[]).map(({ key, state, set }) => ({
    key,
    state: state.status,
    verifiedAtBlock: set.verifiedAtBlock,
    thresholdCheck: set.thresholdCheck.status,
    members: set.members.map((m) => [m.member, m.status, m.source]),
  }));

/** A fresh process's state: nothing read, nothing in memory. */
function fresh() {
  clearCache();
  resetRpcClients();
  resetSafeClient();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fresh();
  resetPresence();
});

afterEach(() => {
  stopSync();
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a read the node fails to answer for a moment (-32603 Internal error)", () => {
  it("is asked again: the JSON detail is 200 with the verdicts a node without the failure gives", async () => {
    world();
    const clean = await detail();
    expect(clean.status).toBe(200);
    const council = verdicts(clean.body).find((s) => s.key === "securityCouncil");
    expect(council).toMatchObject({
      state: "open",
      verifiedAtBlock: HEAD.toString(),
      thresholdCheck: "met",
    });
    expect(council?.members.map(([, status]) => status)).toEqual(["valid", "valid", "missing"]);

    // The same chain, from scratch, with the node failing the first checkSignatures and the first
    // signedMessages (the third member's on-chain approval) at the head once each.
    fresh();
    const { l1, failed } = world({ failOnce: ["checkSignatures", "signedMessages"] });
    const faulted = await detail();
    expect(failed).toEqual(expect.arrayContaining(["checkSignatures", "signedMessages"]));
    expect(failed).toHaveLength(2);
    expect(faulted.status).toBe(200);
    expect(faulted.body.error).toBeUndefined();
    expect(verdicts(faulted.body)).toEqual(verdicts(clean.body));
    // Each failed read was asked again at the same block.
    const atHead = (name: string) =>
      l1.calls.filter(
        (c) => c.functionName === name && c.block === numberToHex(HEAD) && !c.viaMulticall
      ).length;
    expect(atHead("checkSignatures")).toBeGreaterThan(1);
    expect(atHead("signedMessages")).toBeGreaterThan(1);
    // The lanes' retries wait in real time: about 2-3 s alone, longer under load.
  }, 20_000);

  it("a node that keeps failing a read still fails the answer (502), never with a verdict", async () => {
    const { l1, failed } = world({ failAlways: ["signedMessages"] });
    const response = await detail();
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: expect.stringMatching(/Internal error/) });
    // The read that failed the answer was asked three times (once, then twice again); no read
    // more often. The answer fails with the first one that stood.
    const reads = l1.calls.filter((c) => c.functionName === "signedMessages");
    expect(failed.length).toBe(reads.length);
    const perRead = new Map<string, number>();
    for (const c of reads) {
      const key = `${c.to}:${String(c.args[0])}`;
      perRead.set(key, (perRead.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perRead.values())).toBe(3);
  });
});
