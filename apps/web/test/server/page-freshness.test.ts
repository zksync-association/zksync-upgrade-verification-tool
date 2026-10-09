import type { Lane } from "@/.server/chain/jsonrpc";
import type { SignatureSet } from "@/.server/signatures";
import { guardiansAbi, safeAbi } from "@/common/abis";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import { type Address, type Hex, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ContractCall, contracts, fakeCallLane, revertWith } from "../support/fake-calls";
import { EMERGENCY_ID, MAINNET, SAFE_MESSAGES } from "../support/fixtures";

// A page's first answer (freshness "page") against JSON's strict one, with the real Safe snapshot
// store and Safe client in front of a fake Safe Transaction Service, and the governance contract
// behind a fake JSON-RPC upstream. A page may show Safe copies older than 60 s and a set's last
// result from an older block, labelled, and never as current; the strict result always follows,
// and is the only thing JSON ever gets. Nothing about a supplied signature (?sig=) is kept.

const state = vi.hoisted(() => ({
  lane: null as Lane | null,
  head: {
    number: 1_100n,
    hash: `0x${"a1".repeat(32)}`,
    parentHash: `0x${"00".repeat(32)}`,
    timestamp: 1n,
  } as { number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint },
  // The head is cached (servedHead answers without asking the node).
  served: true as boolean | "reading",
  devNode: false,
  // `${signer}:${signature}` the contract accepts.
  valid: new Set<string>(),
  // Safe: each Safe's messages (lower-case address), what answers wait for, requests sent.
  lists: new Map<string, unknown[]>(),
  gate: null as Promise<void> | null,
  sent: [] as string[],
  // How far this test has moved the clock (ms).
  offset: 0,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    safeWalletPrefix: "eth",
    isDevNode: state.devNode,
    // Self-hosted: requests are not spaced, so the test runs in real time.
    safeTxServiceUrl: "https://safe-tx.example.test",
  }),
  latestBlock: async () => state.head,
  // "reading": a head read is in flight (after a pause) and has not answered yet.
  servedHead: () =>
    state.served === "reading"
      ? new Promise(() => {})
      : state.served
        ? Promise.resolve(state.head)
        : null,
  servedHeadNow: () => (state.served === true ? state.head : null),
  safeBlockNumber: async () => 1_000n,
  rpcGeneration: () => 1,
  lanes: () => ({ call: state.lane }),
}));

vi.mock("@/.server/governance", async () => {
  const { cached } = await import("@/.server/cache");
  const safeInfoKey = (address: string) => `safe-info:${address.toLowerCase()}`;
  return {
    safeInfoKey,
    safeInfo: (address: string) =>
      cached(safeInfoKey(address), 5 * 60_000, async () => ({
        address,
        isContract: true,
        version: "1.3.0",
        threshold: 1,
        owners: [],
        domainSeparatorMatches: true,
      })),
  };
});

const { verifySignatureSet, firstSignatureSet, watchSignatureSet } = await import(
  "@/.server/signatures"
);
/** The key a page reports for a set it shows. */
const SET_KEY = /^set:[0-9a-f]{32}$/;
const { streamSignatureSet } = await import("@/.server/flows/common");
const { collectHeldMessages, collectMessages } = await import("@/.server/flows/messages");
const { listSafeMessages } = await import("@/.server/safe/store");
const { clearCache } = await import("@/.server/cache");
const { resetSafeClient } = await import("@/.server/safe-api");
const { safeMessageHashes } = await import("@/common/safe");

const COUNCIL = getAddress("0x59195219d1176E42f8e607e9AC114926D47f9035");
const MEMBERS = [
  "0x1000000000000000000000000000000000000001",
  "0x2000000000000000000000000000000000000002",
].map((a) => getAddress(a)) as [Address, Address];
const typedData = buildTypedData(
  "ApproveUpgradeSecurityCouncil",
  { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
  { id: `0x${"11".repeat(32)}` }
);
const { digest } = governanceHashes(typedData);
const params = {
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup: "securityCouncil",
  typedData,
  members: MEMBERS,
  threshold: 2,
  check: { kind: "multisig", contract: COUNCIL },
  open: true,
} as const;
const SIG_A: Hex = `0x${"aa".repeat(65)}`;
const SIG_B: Hex = `0x${"bb".repeat(65)}`;
// A signature the viewer supplies in the URL: it must never be kept anywhere.
const SUPPLIED: Hex = `0x${"cd".repeat(65)}`;

const realNow = Date.now.bind(Date);
/** Moves this process's clock forward. */
const later = (ms: number) => {
  state.offset += ms;
};
const iso = (ms: number) => new Date(ms).toISOString();

/** `member` signed the set's message in its Safe (one owner, the Safe's threshold). */
function signInSafe(member: Address, signature: Hex) {
  const messageHash = safeMessageHashes(1, member, digest).safeMessageHash;
  const list = state.lists.get(member.toLowerCase()) ?? [];
  list.push({
    created: new Date(Date.now()).toISOString(),
    modified: new Date(Date.now()).toISOString(),
    safe: member,
    messageHash,
    message: typedData,
    confirmations: [{ owner: member, signature, signatureType: "EOA" }],
    preparedSignature: signature,
  });
  state.lists.set(member.toLowerCase(), list);
  state.valid.add(`${member}:${signature}`);
}

/** Safe answers are held until the returned release is called. */
function holdSafe() {
  let release!: () => void;
  state.gate = new Promise((resolve) => {
    release = () => {
      state.gate = null;
      resolve();
    };
  });
  return release;
}

/** Whether `promise` settled within `ms` of real time. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

const statuses = (set: SignatureSet) => set.members.map((m) => m.status);

function answer(call: ContractCall): unknown {
  if (call.functionName === "signedMessages") return 0n;
  if (call.functionName === "checkSignatures") {
    const [, signers, signatures] = call.args as [Hex, string[], Hex[]];
    for (const [i, signer] of signers.entries())
      if (!state.valid.has(`${signer}:${signatures[i]}`))
        return revertWith("Signature verification failed");
    return undefined;
  }
  throw new Error(`unexpected ${call.functionName}`);
}

beforeEach(() => {
  state.offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + state.offset);
  clearCache();
  resetSafeClient();
  state.head = { ...state.head, number: 1_100n, hash: `0x${"a1".repeat(32)}` };
  state.served = true;
  state.devNode = false;
  state.valid.clear();
  state.lists.clear();
  state.gate = null;
  state.sent = [];
  state.lane = fakeCallLane(contracts({ abis: [guardiansAbi, safeAbi], call: answer })).lane;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      state.sent.push(url.pathname);
      await state.gate;
      const list = /\/api\/v1\/safes\/(0x[0-9a-fA-F]{40})\/messages\/$/.exec(url.pathname);
      if (!list) return new Response(null, { status: 404 });
      const all = state.lists.get((list[1] as string).toLowerCase()) ?? [];
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return new Response(
        JSON.stringify({ count: all.length, results: all.slice(offset, offset + limit) }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
});

afterEach(() => {
  state.gate = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a page's first answer for a signature set", () => {
  it("comes at once from 10-minute-old Safe copies, labelled, and the fresh result follows", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    // The listings were read 10 minutes ago (no result of this set is known).
    const listed = await Promise.all(MEMBERS.map((member) => listSafeMessages(member)));
    const readAt = Math.min(...listed.map((listing) => listing.fetchedAt));
    later(10 * 60_000);
    // Meanwhile the second member signed; Safe is slow to answer now.
    signInSafe(MEMBERS[1], SIG_B);
    const release = holdSafe();
    const sent = state.sent.length;

    const streamed = streamSignatureSet({ ...params }, "page");
    expect(streamed.immediate).not.toBe(streamed.fresh);
    const first = await streamed.immediate;
    // Verified at the head from the copies held, without Safe: labelled with both.
    expect(first).toMatchObject({
      stale: true,
      verifiedAtBlock: "1100",
      reverifyingAt: "1100",
      safeFetchedAt: iso(readAt),
    });
    expect(statuses(first)).toEqual(["valid", "missing"]);
    expect(first.thresholdCheck).toMatchObject({ status: "below", valid: 1 });
    expect(await settlesWithin(streamed.fresh, 50)).toBe(false);

    release();
    const fresh = await streamed.fresh;
    expect(fresh).toMatchObject({ stale: false, verifiedAtBlock: "1100" });
    expect(statuses(fresh)).toEqual(["valid", "valid"]);
    expect(fresh.thresholdCheck.status).toBe("met");
    // The page rule: the member whose signature is valid from its older copy keeps that copy
    // (labelled with its age); the member that is not was read again. Only the page's own result
    // asked Safe, for that one listing.
    expect(fresh.safeFetchedAt).toBe(iso(listed[0]?.fetchedAt as number));
    expect(state.sent.length - sent).toBe(1);
  });

  it("is the set's last result at its older block while the head moved on, never reported as fresh; JSON waits", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    const readFrom = Date.now();
    const atOld = await verifySignatureSet({ ...params });
    expect(atOld).toMatchObject({ stale: false, verifiedAtBlock: "1100" });
    expect(Date.parse(atOld.safeFetchedAt as string)).toBeGreaterThanOrEqual(readFrom);
    // A new head, ten minutes on; Safe slow, and a second signature in it.
    state.head = { ...state.head, number: 1_101n, hash: `0x${"b2".repeat(32)}` };
    later(10 * 60_000);
    signInSafe(MEMBERS[1], SIG_B);
    const release = holdSafe();

    const json = verifySignatureSet({ ...params });
    const page = streamSignatureSet({ ...params }, "page");
    const first = await page.immediate;
    expect(first).toMatchObject({
      stale: true,
      verifiedAtBlock: "1100",
      reverifyingAt: "1101",
      safeFetchedAt: atOld.safeFetchedAt,
    });
    expect(statuses(first)).toEqual(["valid", "missing"]);
    // A copy: the kept result JSON answers with is not marked.
    expect(first).not.toBe(atOld);
    expect(atOld.stale).toBe(false);
    // JSON waits for Safe and the head, as before.
    expect(await settlesWithin(json, 50)).toBe(false);
    expect(await settlesWithin(page.fresh, 0)).toBe(false);

    release();
    for (const fresh of [await json, await page.fresh]) {
      expect(fresh).toMatchObject({ stale: false, verifiedAtBlock: "1101" });
      expect(fresh.reverifyingAt).toBeUndefined();
      expect(statuses(fresh)).toEqual(["valid", "valid"]);
    }
  });

  it("is the fresh result itself when the result at the head still stands", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    const strict = await verifySignatureSet({ ...params });
    const sent = state.sent.length;
    const page = streamSignatureSet({ ...params }, "page");
    const [first, fresh] = await Promise.all([page.immediate, page.fresh]);
    expect(first).toBe(fresh);
    // The page's own result: the same verdicts from the same copies, with the key the page
    // reports while it shows the set, its content's revision and how its copies are kept; JSON's
    // (the kept strict result) has none of them.
    expect(first).toEqual({
      ...strict,
      watch: { key: expect.stringMatching(SET_KEY), rev: expect.stringMatching(/^[1-9]\d*$/) },
      safeCheck: expect.objectContaining({ state: "off" }),
    });
    expect(strict.watch).toBeUndefined();
    expect(first.stale).toBe(false);
    expect(state.sent.length).toBe(sent);
  });

  it("says nothing of Safe checks for an open set whose members are all valid: none is checked", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    signInSafe(MEMBERS[1], SIG_B);
    const fresh = await streamSignatureSet({ ...params }, "page").fresh;
    expect(statuses(fresh)).toEqual(["valid", "valid"]);
    // The page then shows its copies' age, not "Safe not checked yet".
    expect(fresh.safeCheck).toBeNull();
    expect(fresh.safeFetchedAt).not.toBeNull();
  });

  it("is the fresh result when no Safe listing is held (a fresh process): nothing older to show", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    const release = holdSafe();
    const page = streamSignatureSet({ ...params }, "page");
    expect(await settlesWithin(page.immediate, 50)).toBe(false);
    release();
    const [first, fresh] = await Promise.all([page.immediate, page.fresh]);
    expect(first).toBe(fresh);
    expect(first).toMatchObject({ stale: false, verifiedAtBlock: "1100" });
  });

  it("is the fresh result when every listing held is at most 60 s old", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    await Promise.all(MEMBERS.map((member) => listSafeMessages(member)));
    later(30_000);
    const page = streamSignatureSet({ ...params }, "page");
    const [first, fresh] = await Promise.all([page.immediate, page.fresh]);
    expect(first).toBe(fresh);
    expect(first.stale).toBe(false);
  });

  it("without a cached head, shows the last result at once, without a head to name", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    await verifySignatureSet({ ...params });
    later(10 * 60_000);
    state.served = false;
    const release = holdSafe();
    const first = await firstSignatureSet({ ...params }, verifySignatureSet({ ...params }));
    expect(first).toMatchObject({ stale: true, verifiedAtBlock: "1100", reverifyingAt: null });
    release();
  });

  it("with a last result, never waits for a head read in flight (after a pause): the first flush carries it, labelled", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    await verifySignatureSet({ ...params });
    later(10 * 60_000);
    state.served = "reading";
    const release = holdSafe();
    const first = await settlesWithin(
      firstSignatureSet({ ...params }, new Promise<never>(() => {})),
      50
    );
    expect(first).toBe(true);
    const answer = await firstSignatureSet({ ...params }, new Promise<never>(() => {}));
    expect(answer).toMatchObject({ stale: true, verifiedAtBlock: "1100", reverifyingAt: null });
    release();
  });

  it("is the fresh result on a dev node, and for a past block", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    await Promise.all(MEMBERS.map((member) => listSafeMessages(member)));
    later(10 * 60_000);
    state.devNode = true;
    const dev = streamSignatureSet({ ...params }, "page");
    expect(await dev.immediate).toBe(await dev.fresh);
    expect((await dev.fresh).verifiedAtBlock).toBeNull();
    state.devNode = false;
    const past = { ...params, blockNumber: 900n };
    const fresh = verifySignatureSet(past);
    expect(await firstSignatureSet(past, fresh)).toBe(await fresh);
    expect((await fresh).verifiedAtBlock).toBe("900");
  });

  it("JSON (strict) is one promise, waits for Safe, and is labelled fresh", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    const readAt = Date.now();
    await Promise.all(MEMBERS.map((member) => listSafeMessages(member)));
    later(10 * 60_000);
    const release = holdSafe();
    const strict = streamSignatureSet({ ...params }, "strict");
    expect(strict.immediate).toBe(strict.fresh);
    expect(await settlesWithin(strict.fresh, 50)).toBe(false);
    release();
    const set = await strict.fresh;
    expect(set.stale).toBe(false);
    // JSON never carries a page's key.
    expect(set.watch).toBeUndefined();
    expect(Date.parse(set.safeFetchedAt as string)).toBeGreaterThan(readAt + 10 * 60_000 - 1);
  });
});

describe("a signature the viewer supplies (?sig=)", () => {
  it("never appears in a kept result or the last results a page shows first", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    state.valid.add(`${MEMBERS[1]}:${SUPPLIED}`);
    const supplied = [{ signer: MEMBERS[1], signature: SUPPLIED }];
    // Page and JSON with the signature: checked afresh, the first answer is the fresh one.
    const withSig = streamSignatureSet({ ...params, supplied }, "page");
    const [first, fresh] = await Promise.all([withSig.immediate, withSig.fresh]);
    expect(first).toBe(fresh);
    expect(first.members[1]).toMatchObject({ status: "valid", source: "supplied" });
    // The page reports the set without the signature: the same key as without it.
    expect(first.watch).toEqual(watchSignatureSet({ ...params }));
    expect((await verifySignatureSet({ ...params, supplied })).thresholdCheck.status).toBe("met");

    // Without it, at the same head: nothing kept carries it.
    const strict = await verifySignatureSet({ ...params });
    expect(statuses(strict)).toEqual(["valid", "missing"]);
    expect(JSON.stringify(strict)).not.toContain(SUPPLIED.slice(2));

    // A new head, old copies, Safe slow: the page's first answer (the last result) lacks it too.
    state.head = { ...state.head, number: 1_101n, hash: `0x${"b2".repeat(32)}` };
    later(10 * 60_000);
    const release = holdSafe();
    const page = streamSignatureSet({ ...params }, "page");
    const shown = await page.immediate;
    expect(shown.stale).toBe(true);
    expect(statuses(shown)).toEqual(["valid", "missing"]);
    expect(JSON.stringify(shown)).not.toContain(SUPPLIED.slice(2));
    release();
    expect(JSON.stringify(await page.fresh)).not.toContain(SUPPLIED.slice(2));

    // With the signature again, at a newer head with old copies while a last result is known:
    // never the last result (nor old copies), only the fresh check with the signature.
    state.head = { ...state.head, number: 1_102n, hash: `0x${"c3".repeat(32)}` };
    later(10 * 60_000);
    const releaseAgain = holdSafe();
    const again = streamSignatureSet({ ...params, supplied }, "page");
    expect(await settlesWithin(again.immediate, 50)).toBe(false);
    releaseAgain();
    const shownAgain = await again.immediate;
    expect(shownAgain).toBe(await again.fresh);
    expect(shownAgain.stale).toBe(false);
    expect(shownAgain.members[1]).toMatchObject({ status: "valid", source: "supplied" });
  });

  it("is never what a first answer from old copies is computed from", async () => {
    signInSafe(MEMBERS[0], SIG_A);
    state.valid.add(`${MEMBERS[1]}:${SUPPLIED}`);
    // Only a request with the signature has verified this set (it read the listings).
    const withSig = await verifySignatureSet({
      ...params,
      supplied: [{ signer: MEMBERS[1], signature: SUPPLIED }],
    });
    expect(withSig.thresholdCheck.status).toBe("met");
    later(10 * 60_000);
    const release = holdSafe();
    const page = streamSignatureSet({ ...params }, "page");
    const shown = await page.immediate;
    expect(shown.stale).toBe(true);
    expect(statuses(shown)).toEqual(["valid", "missing"]);
    expect(JSON.stringify(shown)).not.toContain(SUPPLIED.slice(2));
    release();
    await page.fresh;
  });
});

describe("pending messages from Safe listings held", () => {
  const SAFES = Object.keys(SAFE_MESSAGES).map((s) => getAddress(s));
  const board = {
    name: "EmergencyUpgradeBoard",
    version: "1",
    chainId: 1,
    verifyingContract: MAINNET.emergencyUpgradeBoard,
  };
  const EMERGENCY = [
    "ExecuteEmergencyUpgradeSecurityCouncil",
    "ExecuteEmergencyUpgradeGuardians",
    "ExecuteEmergencyUpgradeZKFoundation",
  ] as const;
  const count = (groups: { typedData: { message: Record<string, unknown> } }[]) =>
    groups.filter((g) => g.typedData.message.id === EMERGENCY_ID).length;

  it("are listed from copies of any age, labelled, only once every Safe has one; the strict list reads Safe", async () => {
    for (const [safe, messages] of Object.entries(SAFE_MESSAGES))
      state.lists.set(safe.toLowerCase(), messages);
    expect(await collectHeldMessages(SAFES, EMERGENCY, board)).toBeNull();
    const readAt = Date.now();
    const strict = await collectMessages(SAFES, EMERGENCY, board);
    expect(strict).toMatchObject({ stale: false, errors: [], anomalies: 0 });
    expect(Date.parse(strict.safeFetchedAt as string)).toBeGreaterThanOrEqual(readAt);
    expect(count(strict.groups)).toBe(3);
    const sent = state.sent.length;

    // Within 60 s: the same list, not stale.
    expect(await collectHeldMessages(SAFES, EMERGENCY, board)).toMatchObject({ stale: false });
    // Ten minutes on: still listed, labelled with the oldest copy's age, without asking Safe.
    later(10 * 60_000);
    const held = await collectHeldMessages(SAFES, EMERGENCY, board);
    expect(held).toMatchObject({ stale: true, safeFetchedAt: strict.safeFetchedAt });
    expect(held?.groups).toEqual(strict.groups);
    expect(state.sent.length).toBe(sent);
    // The strict list reads them again.
    const fresh = await collectMessages(SAFES, EMERGENCY, board);
    expect(fresh.stale).toBe(false);
    expect(state.sent.length).toBe(sent + SAFES.length);
  });
});
