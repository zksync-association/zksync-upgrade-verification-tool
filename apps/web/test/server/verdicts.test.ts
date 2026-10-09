import { clearCache } from "@/.server/cache";
import { NoContract, UpstreamError } from "@/.server/chain/call";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { isEcdsaOnly, resetVerdicts, verdictCounts } from "@/.server/chain/verdicts";
import { latestBlock, resetRpcClients } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { type SignatureSetParams, verifySignatureSet } from "@/.server/signatures";
import { stopSync } from "@/.server/sync/engine";
import { resetPresence } from "@/.server/sync/presence";
import { type Hex, getAddress, numberToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRpcError } from "../support/fake-jsonrpc";
import {
  FAKE_PINS,
  type FakeL1Options,
  G_MEMBERS,
  L1,
  RawAnswer,
  SC_MEMBERS,
} from "../support/fake-l1";
import { NOW, ecdsa, liveWorld, settle } from "../support/live-world";

// The verdict fast path (chain/verdicts.ts): a set's checks at a head go out in the head's
// aggregate3, and only POSITIVES are taken from it, for ECDSA-only candidates on contracts that
// run pinned code; everything else is asked directly (chain/call.ts), where only a definite revert
// rejects. JSON (strict) uses it too.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
  resetPresence({ keepWarmMs: 600_000 });
  resetVerdicts();
  overrideCodePinsForTests(FAKE_PINS);
});

afterEach(() => {
  stopSync();
  overrideCodePinsForTests(undefined);
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type World = ReturnType<typeof liveWorld>;

const calls = (w: World, functionName: string, viaMulticall: boolean) =>
  w.fake.calls.filter((c) => c.functionName === functionName && c.viaMulticall === viaMulticall);

const council = (w: World) => w.sets[0] as SignatureSetParams;
const zkFoundation = (w: World) => w.sets[5] as SignatureSetParams;
const emergencyCouncil = (w: World) => w.sets[3] as SignatureSetParams;

/** A world with one option replaced (the rest as liveWorld's). */
const world = (options: Omit<FakeL1Options, "head" | "logs" | "upgrades"> = {}) =>
  liveWorld(options);

describe("which signatures may go through the aggregate", () => {
  it("only one or more 65-byte segments, each with v 27, 28, 31 or 32", () => {
    expect(isEcdsaOnly(ecdsa(1, 27))).toBe(true);
    expect(isEcdsaOnly(ecdsa(1, 28))).toBe(true);
    expect(isEcdsaOnly(ecdsa(1, 31))).toBe(true);
    expect(isEcdsaOnly(`${ecdsa(1, 32)}${ecdsa(2, 27).slice(2)}` as Hex)).toBe(true);
    // A contract signature (v = 0, its owner's code runs), an approved hash (v = 1).
    expect(isEcdsaOnly(ecdsa(1, 0))).toBe(false);
    expect(isEcdsaOnly(ecdsa(1, 1))).toBe(false);
    expect(isEcdsaOnly(`${ecdsa(1, 27)}${ecdsa(2, 0).slice(2)}` as Hex)).toBe(false);
    // No signature (an on-chain approval), a cut one, a v = 0 one with its dynamic part.
    expect(isEcdsaOnly("0x")).toBe(false);
    expect(isEcdsaOnly(ecdsa(1).slice(0, -2) as Hex)).toBe(false);
    expect(isEcdsaOnly(`${ecdsa(1, 0)}${"00".repeat(32)}` as Hex)).toBe(false);
  });
});

describe("S-23: strict (JSON) verdicts at the head", () => {
  it("take the positives of ECDSA candidates on pinned contracts from the head's aggregate: no direct check", async () => {
    const w = world();
    const head = await settle(latestBlock());
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(set.thresholdCheck.status).toBe("met");
    expect(set.verifiedAtBlock).toBe(head.number.toString());
    // Two members and the threshold, all in aggregates at the head; the third member's on-chain
    // approval (signedMessages) too.
    expect(calls(w, "checkSignatures", true)).toHaveLength(3);
    expect(calls(w, "checkSignatures", false)).toHaveLength(0);
    expect(calls(w, "signedMessages", false)).toHaveLength(0);
    expect(
      calls(w, "checkSignatures", true).every((c) => c.block === numberToHex(head.number))
    ).toBe(true);
    expect(verdictCounts(head.number.toString())).toMatchObject({ fast: 3, reasked: 0, direct: 0 });
  });

  it("the emergency sets: the council's isValidSignature and the ZK Foundation Safe's (its singleton and handler read beside it)", async () => {
    const w = world();
    const council1271 = await settle(verifySignatureSet(emergencyCouncil(w)));
    expect(council1271.thresholdCheck.status).toBe("met");
    const zkf = await settle(verifySignatureSet(zkFoundation(w)));
    expect(zkf.members.map((m) => m.status)).toEqual(["valid"]);
    expect(zkf.thresholdCheck.status).toBe("met");
    expect(calls(w, "isValidSignature", false)).toHaveLength(0);
    expect(calls(w, "isValidSignature", true).length).toBeGreaterThanOrEqual(3);
    // The singleton and handler of every Safe whose code a check ran, once each at the head: the
    // council's three member Safes and the ZK Foundation Safe.
    const profiled = [...SC_MEMBERS, L1.zkFoundation].map((a) => getAddress(a)).sort();
    expect(
      calls(w, "masterCopy", true)
        .map((c) => c.to)
        .sort()
    ).toEqual(profiled);
    expect(
      calls(w, "getStorageAt", true)
        .map((c) => c.to)
        .sort()
    ).toEqual(profiled);
  });

  it("a member Safe on another singleton (its isValidSignature runs inside the council's check): its checks are asked directly, the others' not", async () => {
    const odd = SC_MEMBERS[0] as Hex;
    const w = world({
      answer: (call) =>
        call.functionName === "masterCopy" && call.to === getAddress(odd)
          ? getAddress(`0x${"5a".repeat(20)}`)
          : undefined,
    });
    const head = await settle(latestBlock());
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(set.thresholdCheck.status).toBe("met");
    // That member's own check and the threshold check (which carries it) went direct.
    const direct = calls(w, "checkSignatures", false);
    expect(direct).toHaveLength(2);
    expect(direct.every((c) => (c.args[1] as Hex[]).includes(getAddress(odd)))).toBe(true);
    expect(verdictCounts(head.number.toString())).toMatchObject({ fast: 1, reasked: 2 });
  });

  it("a member Safe that does not run the pinned proxy: its checks and its signedMessages are asked directly", async () => {
    const signer = SC_MEMBERS[1] as Hex;
    const silent = SC_MEMBERS[2] as Hex;
    const w = world({
      code: (address) =>
        address === getAddress(signer) || address === getAddress(silent)
          ? "0x60806040aa"
          : undefined,
    });
    const head = await settle(latestBlock());
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(set.thresholdCheck.status).toBe("met");
    expect(
      calls(w, "checkSignatures", true).some((c) =>
        (c.args[1] as Hex[]).includes(getAddress(signer))
      )
    ).toBe(false);
    expect(calls(w, "signedMessages", true)).toHaveLength(0);
    expect(calls(w, "signedMessages", false)).toHaveLength(1);
    expect(verdictCounts(head.number.toString())).toMatchObject({ fast: 1, direct: 2 });
  });

  it("a member Safe whose singleton is not the pinned one: its signedMessages is asked directly", async () => {
    const silent = SC_MEMBERS[2] as Hex;
    const w = world({
      answer: (call) =>
        call.functionName === "masterCopy" && call.to === getAddress(silent)
          ? getAddress(`0x${"5a".repeat(20)}`)
          : undefined,
    });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(calls(w, "signedMessages", false)).toHaveLength(1);
  });

  it("a ZK Foundation Safe on another singleton: its isValidSignature is asked directly", async () => {
    const w = world({
      answer: (call) =>
        call.functionName === "masterCopy" ? getAddress(`0x${"5a".repeat(20)}`) : undefined,
    });
    const zkf = await settle(verifySignatureSet(zkFoundation(w)));
    expect(zkf.thresholdCheck.status).toBe("met");
    expect(calls(w, "isValidSignature", false).length).toBeGreaterThanOrEqual(1);
  });

  it("without pins (Sepolia, local chains, an overridden trust anchor): every check is direct", async () => {
    overrideCodePinsForTests(null);
    const w = world();
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.thresholdCheck.status).toBe("met");
    expect(calls(w, "checkSignatures", true)).toHaveLength(0);
    expect(calls(w, "signedMessages", true)).toHaveLength(0);
    expect(calls(w, "checkSignatures", false)).toHaveLength(3);
  });
});

describe("S-26: never through the aggregate", () => {
  it("a candidate with a contract signature (v = 0): that member is asked directly", async () => {
    const contractSignature = `${ecdsa(77, 0)}${"00".repeat(32)}` as Hex;
    const w = world();
    // The first council member's Safe signed with a v = 0 segment instead.
    const member = SC_MEMBERS[0] as Hex;
    w.signatures.add(`${member}:${contractSignature}`.toLowerCase());
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const response = await original(input as string, init);
      if (!String(input).includes(`/safes/${member}/messages/`)) return response;
      const body = (await response.json()) as { results: { preparedSignature: Hex }[] };
      for (const message of body.results) message.preparedSignature = contractSignature;
      return Response.json(body);
    });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members[0]).toMatchObject({ status: "valid", signature: contractSignature });
    const direct = calls(w, "checkSignatures", false);
    expect(direct.map((c) => (c.args[2] as Hex[])[0])).toContain(contractSignature);
    expect(
      calls(w, "checkSignatures", true).some((c) =>
        (c.args[2] as Hex[]).includes(contractSignature)
      )
    ).toBe(false);
    // The threshold check carries it too: asked directly.
    expect(
      calls(w, "checkSignatures", false).some((c) => (c.args[1] as unknown[]).length > 1)
    ).toBe(true);
  });

  it("a check contract whose code is not the pinned code: its checks are direct, the others' not", async () => {
    const w = world({
      code: (address) => (address === L1.securityCouncil ? "0x60806040aa" : undefined),
    });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.thresholdCheck.status).toBe("met");
    expect(calls(w, "checkSignatures", true).some((c) => c.to === L1.securityCouncil)).toBe(false);
    const guardians = await settle(verifySignatureSet(w.sets[1] as SignatureSetParams));
    expect(guardians.thresholdCheck.status).toBe("met");
    expect(calls(w, "checkSignatures", true).filter((c) => c.to === L1.guardians)).toHaveLength(3);
  });
});

describe("S-19: only positives come from the aggregate", () => {
  it("a corrupted signature: the aggregate's (false, ·) is asked directly, and only that definite revert rejects", async () => {
    const w = world();
    // The second member's signature is no longer accepted (e.g. an owner was replaced).
    for (const entry of [...w.signatures])
      if (entry.startsWith((SC_MEMBERS[1] as string).toLowerCase())) w.signatures.delete(entry);
    const head = await settle(latestBlock());
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "invalid", "missing"]);
    expect(set.members[1]?.error).toBeTruthy();
    expect(set.thresholdCheck).toMatchObject({ status: "below" });
    expect(calls(w, "checkSignatures", false)).toHaveLength(1);
    expect(verdictCounts(head.number.toString())).toMatchObject({ fast: 1, reasked: 1 });
  });

  it("a sub-call starved of gas ((false, 0x)) for a valid signature: asked directly, valid", async () => {
    const member = SC_MEMBERS[0] as Hex;
    const w = world({
      inject: (call) =>
        call.viaMulticall &&
        call.functionName === "checkSignatures" &&
        (call.args[1] as Hex[])[0] === member &&
        (call.args[1] as Hex[]).length === 1
          ? new FakeRpcError(-32000, "out of gas")
          : undefined,
    });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(set.thresholdCheck.status).toBe("met");
    expect(calls(w, "checkSignatures", false)).toHaveLength(1);
  });

  it("a void (true, 0x) where the contract has no code at that block is never an acceptance", async () => {
    let codeless: string | null = null;
    const w = world({
      // Code at 'latest' (the pins match), none at the head asked about.
      code: (address, block) =>
        address === L1.securityCouncil && block === codeless ? "0x" : undefined,
      answer: (call) =>
        call.to === L1.securityCouncil &&
        call.block === codeless &&
        (call.functionName === "EIP1271_THRESHOLD" || call.functionName === "checkSignatures")
          ? new RawAnswer("0x")
          : undefined,
    });
    const head = await settle(latestBlock());
    codeless = numberToHex(head.number);
    await expect(settle(verifySignatureSet(council(w)))).rejects.toBeInstanceOf(NoContract);
    expect(verdictCounts(head.number.toString()).fast).toBe(0);
  });

  it("a whole aggregate that fails (out of gas, -32603) gives no verdict: every check is asked directly", async () => {
    const w = world({ aggregateError: () => new FakeRpcError(-32000, "out of gas") });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(set.thresholdCheck.status).toBe("met");
    expect(calls(w, "checkSignatures", false)).toHaveLength(3);
  });

  it("…and with the direct reads failing too, the answer fails: never invalid, missing or rejected", async () => {
    const w = world({
      aggregateError: () => new FakeRpcError(-32603, "internal error"),
      inject: (call) =>
        !call.viaMulticall && call.functionName === "checkSignatures"
          ? new FakeRpcError(-32603, "internal error")
          : undefined,
    });
    await expect(settle(verifySignatureSet(council(w)))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("signedMessages answering no data in the aggregate is asked directly", async () => {
    const w = world({
      answer: (call) =>
        call.viaMulticall && call.functionName === "signedMessages"
          ? new RawAnswer("0x")
          : undefined,
    });
    const set = await settle(verifySignatureSet(council(w)));
    expect(set.members.map((m) => m.status)).toEqual(["valid", "valid", "missing"]);
    expect(calls(w, "signedMessages", false)).toHaveLength(1);
  });

  it("SYNC_VERDICT_AGGREGATE=0's path (the fast path resting) asks everything directly", async () => {
    const w = world({ aggregateError: () => new FakeRpcError(-32000, "out of gas") });
    // Three whole-call failures in a row: the fast path rests (every check direct for a while).
    for (const set of [council(w), w.sets[1], w.sets[3]] as SignatureSetParams[])
      await settle(verifySignatureSet(set));
    const before = w.fake.multicalls.length;
    clearCache();
    await settle(
      verifySignatureSet(G_MEMBERS.length ? (w.sets[4] as SignatureSetParams) : council(w))
    );
    // Only Safe info and states may still use aggregates; no verdict sub-call was sent.
    expect(
      w.fake.aggregates
        .slice(before)
        .some(
          (a) => a.functions.includes("checkSignatures") || a.functions.includes("isValidSignature")
        )
    ).toBe(false);
  });
});

describe("the fast path's breaker: 3 failed aggregate3 calls in a row", () => {
  /** A world whose next `failing.count` aggregate3 calls fail as a whole (out of gas). */
  function failingWorld() {
    const failing = { count: 0 };
    const w = world({
      aggregateError: () => {
        if (failing.count <= 0) return undefined;
        failing.count--;
        return new FakeRpcError(-32000, "out of gas");
      },
    });
    return { w, failing };
  }

  /** Every set verified once at the head (their Safe info and listings read), then a new head. */
  async function warmThenNextHead(w: World) {
    for (const set of w.sets) await settle(verifySignatureSet(set));
    return nextHead(w);
  }

  async function nextHead(w: World) {
    w.nextBlock();
    await vi.advanceTimersByTimeAsync(12_000);
    return settle(latestBlock());
  }

  const verdictsSince = (w: World, from: number) =>
    w.fake.aggregates
      .slice(from)
      .some(
        (a) => a.functions.includes("checkSignatures") || a.functions.includes("isValidSignature")
      );

  it("one failed aggregate counts once, however many checks it carried: the next checks still go through the aggregate", async () => {
    const { w, failing } = failingWorld();
    const head = await warmThenNextHead(w);
    failing.count = 1;
    const guardians = await settle(verifySignatureSet(w.sets[1] as SignatureSetParams));
    expect(guardians.thresholdCheck.status).toBe("met");
    expect(failing.count).toBe(0);
    // That one aggregate carried the members' checks and the threshold check's guess: each was
    // asked again directly.
    expect(verdictCounts(head.number.toString()).reasked).toBeGreaterThanOrEqual(3);
    await nextHead(w);
    const before = w.fake.aggregates.length;
    const emergency = await settle(verifySignatureSet(w.sets[4] as SignatureSetParams));
    expect(emergency.thresholdCheck.status).toBe("met");
    expect(verdictsSince(w, before)).toBe(true);
  });

  it("two in a row do not rest it; three do; a settings change (another data source) starts afresh", async () => {
    const { w, failing } = failingWorld();
    await warmThenNextHead(w);
    failing.count = 2;
    for (const set of [w.sets[1], w.sets[3]] as SignatureSetParams[])
      await settle(verifySignatureSet(set));
    expect(failing.count).toBe(0);
    let before = w.fake.aggregates.length;
    await settle(verifySignatureSet(w.sets[4] as SignatureSetParams));
    expect(verdictsSince(w, before)).toBe(true);

    await nextHead(w);
    failing.count = 3;
    for (const set of [w.sets[1], w.sets[3], w.sets[4]] as SignatureSetParams[])
      await settle(verifySignatureSet(set));
    expect(failing.count).toBe(0);
    before = w.fake.aggregates.length;
    const zkf = await settle(verifySignatureSet(zkFoundation(w)));
    expect(zkf.thresholdCheck.status).toBe("met");
    expect(verdictsSince(w, before)).toBe(false);

    // What a settings change does (settings.ts): the new data source's checks use the aggregate.
    clearCache();
    resetRpcClients();
    before = w.fake.aggregates.length;
    const council1 = await settle(verifySignatureSet(council(w)));
    expect(council1.thresholdCheck.status).toBe("met");
    expect(verdictsSince(w, before)).toBe(true);
  });
});
