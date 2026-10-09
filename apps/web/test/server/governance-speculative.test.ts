import { clearCache, invalidate } from "@/.server/cache";
import { UpstreamError } from "@/.server/chain/call";
import { type Governance, readGovernance } from "@/.server/governance";
import { MULTICALL3, latestBlock, network, resetRpcClients } from "@/.server/rpc";
import { type Address, getAddress, numberToHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRpcError, type FakePost } from "../support/fake-jsonrpc";
import { type FakeL1Options, L1, REVERTS, SC_MEMBERS, fakeL1 } from "../support/fake-l1";

// Governance in one round (plan D1): with the layout of the last read (the three contracts the
// handler names, how many members each list has), every getter goes out in ONE POST at the head's
// block: the handler's code, one aggregate3 of everything, and both member lists' terminators
// asked directly (4 billed entries). It is taken only if the handler names the same contracts,
// every sub-call answered, and both terminators definitely reverted; otherwise the read goes in
// rounds as before, and answers exactly as a read in rounds does. A fresh process reads in three
// rounds (the handler's code beside its getters).

const NOW = 1_800_000_000_000;
const HEAD = 26_129_107n;
const TAG = numberToHex(HEAD);
// Every POST takes this long, so rounds show as distinct start times.
const ROUND_MS = 100;

let fake: ReturnType<typeof fakeL1>;
let options: Pick<FakeL1Options, "answer" | "inject" | "aliases">;

function node(extra: Partial<FakeL1Options> = {}) {
  options = {};
  fake = fakeL1({
    head: { number: HEAD, timestamp: BigInt(NOW / 1000) - 1n },
    finalized: HEAD - 80n,
    delayMs: ROUND_MS,
    answer: (call) => options.answer?.(call),
    inject: (call) => options.inject?.(call),
    aliases: new Map([[NEW_SC, L1.securityCouncil]]),
    ...extra,
  });
  vi.stubGlobal("fetch", fake.fetch);
}

// Another Security Council contract the handler may name (behaving as the first).
const NEW_SC = getAddress("0x5c00000000000000000000000000000000000001");

/** Runs the fake clock until `promise` settles; returns its value or throws its error. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  void tracked.catch(() => {});
  for (let waited = 0; !done; waited += 10) {
    if (waited > 20_000) throw new Error("timed out");
    await vi.advanceTimersByTimeAsync(10);
  }
  return tracked;
}

/** The POSTs a read sent, and in how many rounds (POSTs started within one ROUND_MS share one). */
async function measured(read: () => Promise<Governance>) {
  const from = fake.posts.length;
  const startedAt = Date.now();
  const value = await settle(read());
  const posts = fake.posts.slice(from);
  const rounds = new Set(posts.map((p) => Math.floor((p.startedAt - startedAt) / ROUND_MS))).size;
  return { value, posts, rounds };
}

const methods = (post: FakePost) => post.calls.map((c) => c.method);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  node();
  // The network and the head, as a request has them before it reads governance.
  await settle(Promise.all([network(), latestBlock()]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("governance in one round", () => {
  it("a fresh process reads in three rounds, the handler's code beside its getters", async () => {
    const first = await measured(() => readGovernance());
    expect(first.rounds).toBe(3);
    // Round one: the handler's code and its five getters went out together.
    const start = first.posts[0]?.startedAt ?? 0;
    expect(first.posts.filter((p) => p.startedAt - start < ROUND_MS).flatMap(methods)).toEqual(
      expect.arrayContaining(["eth_getCode", "eth_call"])
    );
    expect(first.value.securityCouncil.members).toEqual(SC_MEMBERS);
    // Every getter was read at the head's block.
    expect(fake.calls.every((c) => c.block === TAG)).toBe(true);
  });

  it("then reads everything in one POST of four billed entries at the head's block, with the same answer", async () => {
    const rounds = await measured(() => readGovernance());
    const one = await measured(() => readGovernance());
    expect(one.rounds).toBe(1);
    expect(one.posts).toHaveLength(1);
    const [post] = one.posts as [FakePost];
    expect(methods(post).sort()).toEqual(["eth_call", "eth_call", "eth_call", "eth_getCode"]);
    // The aggregate3 of every getter, and both terminators asked directly, at the head's block.
    const targets = post.calls.map((c) => c.params[0] as { to?: string } | string);
    expect(
      targets.map((t) => (typeof t === "string" ? t : t.to ?? "").toLowerCase()).sort()
    ).toEqual(
      [
        L1.upgradeHandler.toLowerCase(),
        MULTICALL3.toLowerCase(),
        L1.securityCouncil.toLowerCase(),
        L1.guardians.toLowerCase(),
      ].sort()
    );
    expect(post.calls.every((c) => c.params.includes(TAG))).toBe(true);
    expect(one.value).toEqual(rounds.value);
    expect(one.value.latestBlock.number).toBe(HEAD.toString());
  });

  it("falls back to rounds when the handler names another council, and answers as a read in rounds does", async () => {
    await measured(() => readGovernance());
    options.answer = (call) =>
      call.to === L1.upgradeHandler && call.functionName === "securityCouncil" ? NEW_SC : undefined;
    const moved = await measured(() => readGovernance());
    // The guess (one POST), then the rounds.
    expect(moved.rounds).toBeGreaterThan(1);
    expect(moved.value.securityCouncil.address).toBe(NEW_SC);
    // The same as a read in rounds with nothing guessed.
    invalidate("governance");
    const plain = await measured(() => readGovernance());
    expect(plain.rounds).toBe(3);
    expect(moved.value).toEqual(plain.value);
    // And the next read guesses the new council, in one POST.
    expect((await measured(() => readGovernance())).posts).toHaveLength(1);
  });

  it("falls back to rounds when a member list grew", async () => {
    await measured(() => readGovernance());
    const added: Address = getAddress("0xa00000000000000000000000000000000000000f");
    options.answer = (call) => {
      if (call.to !== L1.securityCouncil || call.functionName !== "members") return undefined;
      const index = Number(call.args[0]);
      if (index === SC_MEMBERS.length) return added;
      return index > SC_MEMBERS.length ? REVERTS : undefined;
    };
    const grown = await measured(() => readGovernance());
    expect(grown.rounds).toBeGreaterThan(1);
    expect(grown.value.securityCouncil.members).toEqual([...SC_MEMBERS, added]);
    invalidate("governance");
    expect(grown.value).toEqual((await measured(() => readGovernance())).value);
  });

  it("falls back to rounds on a terminator that is not a definite revert, and never shortens a list", async () => {
    await measured(() => readGovernance());
    // The council's terminator, asked directly, fails once with an internal error.
    let failures = 1;
    options.inject = (call) =>
      call.to === L1.securityCouncil &&
      call.functionName === "members" &&
      !call.viaMulticall &&
      failures-- > 0
        ? new FakeRpcError(-32603, "internal error")
        : undefined;
    const retried = await measured(() => readGovernance());
    expect(retried.rounds).toBeGreaterThan(1);
    expect(retried.value.securityCouncil.members).toEqual(SC_MEMBERS);
    invalidate("governance");
    expect(retried.value).toEqual((await measured(() => readGovernance())).value);

    // A terminator that keeps failing fails the read: the list is never cut short.
    options.inject = (call) =>
      call.to === L1.securityCouncil && call.functionName === "members" && !call.viaMulticall
        ? new FakeRpcError(-32603, "internal error")
        : undefined;
    await expect(settle(readGovernance())).rejects.toBeInstanceOf(UpstreamError);
  });

  it("asks once more, in one round, when a backend does not know the head yet", async () => {
    const first = await measured(() => readGovernance());
    // The next one-round POST reaches a backend behind the others: every entry "header not found".
    let lagging = 1;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (lagging > 0 && body.includes('"eth_getCode"')) {
        lagging--;
        const calls = JSON.parse(body) as { id: number }[];
        return Response.json(
          calls.map((c) => ({
            jsonrpc: "2.0",
            id: c.id,
            error: { code: -32000, message: "header not found" },
          }))
        );
      }
      return fake.fetch(input as string, init);
    });
    const again = await measured(() => readGovernance());
    expect(lagging).toBe(0);
    // Then the same single POST once more: no rounds at a block that backend did not know.
    expect(again.posts).toHaveLength(1);
    expect((again.posts[0] as FakePost).calls).toHaveLength(4);
    expect(again.value).toEqual(first.value);
  });

  it("falls back to rounds when a getter fails inside the aggregate", async () => {
    const first = await measured(() => readGovernance());
    // The Guardians' domain fails once inside Multicall3; its direct read answers.
    let failures = 1;
    options.inject = (call) =>
      call.to === L1.guardians &&
      call.functionName === "eip712Domain" &&
      call.viaMulticall &&
      failures-- > 0
        ? new FakeRpcError(-32000, "out of gas")
        : undefined;
    const again = await measured(() => readGovernance());
    expect(again.rounds).toBeGreaterThan(1);
    expect(again.value).toEqual(first.value);
  });
});
