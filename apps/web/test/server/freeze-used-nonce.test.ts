import { securityCouncilAbi } from "@/common/abis";
import { type Address, type Hex, encodeFunctionData } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A freeze request whose nonce is used: the transaction that used it, found in the handler's log
// history, and the soft-freeze threshold the contract applied then.

const COUNCIL = "0x3911412575371B726A57117a184aC4963C402C0e" as Address;
const OTHER = "0x00000000000000000000000000000000000000c1" as Address;
const SIGNERS = ["0x0000000000000000000000000000000000000001" as Address];
const SIGS = ["0xaa" as Hex];
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

type Event = { name: string; block: bigint; tx: Hex; after?: Address };
const chain = vi.hoisted(() => ({
  events: [] as { name: string; block: bigint; tx: Hex; after?: Address }[],
  calls: new Map<string, { to: Address; data: Hex } | null>(),
  archive: true,
  threshold: 3n,
  failIndex: false,
}));

vi.mock("@/.server/rpc", () => ({
  network: async () => ({ chainId: 11155111 }),
  // Block n was made at 1_800_000_000 + n.
  blockTimestamps: async (numbers: bigint[]) =>
    new Map(numbers.map((n) => [n, 1_800_000_000n + n])),
}));
vi.mock("@/.server/cache", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cached: (_key: string, _ttl: number, compute: () => Promise<unknown>) => compute(),
}));
vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({
    events: async (name: string, { fromBlock = 0n }: { fromBlock?: bigint } = {}) => {
      if (chain.failIndex) throw new Error("index unavailable");
      return chain.events
        .filter((e) => e.name === name && e.block >= fromBlock)
        .map((e) => ({
          args: { _securityCouncilAfter: e.after },
          log: { transactionHash: e.tx, blockNumber: e.block },
        }));
    },
  }),
}));
vi.mock("@/.server/chain/call", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callFn: async ({ functionName }: { functionName: string }) => {
    if (functionName !== "softFreezeThreshold") throw new Error(functionName);
    return chain.threshold;
  },
}));
vi.mock("@/.server/flows/common", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callTo: async (hash: Hex) => chain.calls.get(hash) ?? null,
  hasArchiveState: async () => chain.archive,
}));

const { usedNonce } = await import("@/.server/flows/freeze");

const gov = { securityCouncil: { address: COUNCIL } } as never;
const call = (fn: "softFreeze" | "hardFreeze" | "unfreeze", validUntil: bigint) => ({
  to: COUNCIL,
  data: encodeFunctionData({
    abi: securityCouncilAbi,
    functionName: fn,
    args: [validUntil, SIGNERS, SIGS],
  }),
});
const tookOffice: Event = { name: "ChangeSecurityCouncil", block: 100n, tx: tx(1), after: COUNCIL };

beforeEach(() => {
  chain.events = [];
  chain.calls = new Map();
  chain.archive = true;
  chain.threshold = 3n;
  chain.failIndex = false;
});

describe("a used freeze nonce", () => {
  it("links the soft freeze that used it, counted from this Council's taking office, with the threshold then", async () => {
    chain.events = [
      // An older Council's soft freeze: not one of this Council's nonces.
      { name: "SoftFreeze", block: 50n, tx: tx(9) },
      tookOffice,
      { name: "SoftFreeze", block: 110n, tx: tx(2) },
      { name: "SoftFreeze", block: 120n, tx: tx(3) },
    ];
    chain.calls.set(tx(3), call("softFreeze", 1000n));
    const used = await usedNonce(gov, { action: "SoftFreeze", nonce: "1", validUntil: "1000" });
    expect(used.state).toEqual({
      status: "done",
      detail: "Executed in block #120",
      txHash: tx(3),
      at: "1800000120",
    });
    expect(used.threshold).toBe(3);
    expect(used.used).toEqual({ validUntil: 1000n, signers: SIGNERS, signatures: SIGS });
  });

  it("says when another request with the same nonce used it (superseded: closed, not done)", async () => {
    chain.events = [tookOffice, { name: "HardFreeze", block: 110n, tx: tx(2) }];
    chain.calls.set(tx(2), call("hardFreeze", 2000n));
    const used = await usedNonce(gov, { action: "HardFreeze", nonce: "0", validUntil: "1000" });
    expect(used.state.status).toBe("closed");
    expect((used.state as { detail: string }).detail).toContain(
      "Superseded: nonce 0 was used by another request"
    );
    expect(used.used).toBeNull();
  });

  it("counts only the Council's own unfreezes (not an expired freeze's or an emergency upgrade's)", async () => {
    chain.events = [
      tookOffice,
      { name: "Unfreeze", block: 110n, tx: tx(2) },
      { name: "Unfreeze", block: 120n, tx: tx(3) },
    ];
    chain.calls.set(tx(3), call("unfreeze", 1000n));
    const used = await usedNonce(gov, { action: "Unfreeze", nonce: "0", validUntil: "1000" });
    expect(used.state).toMatchObject({ status: "done", txHash: tx(3) });
    expect(used.threshold).toBeNull();
  });

  it("without archive state, links it and says the threshold then could not be read", async () => {
    chain.archive = false;
    chain.events = [tookOffice, { name: "SoftFreeze", block: 110n, tx: tx(2) }];
    chain.calls.set(tx(2), call("softFreeze", 1000n));
    const used = await usedNonce(gov, { action: "SoftFreeze", nonce: "0", validUntil: "1000" });
    expect(used.state).toMatchObject({ status: "done", txHash: tx(2) });
    expect((used.state as { detail: string }).detail).toContain(
      "the soft-freeze threshold then could not be read"
    );
    expect(used.threshold).toBeNull();
  });

  it("says so when the history cannot be read now, rather than guess", async () => {
    chain.events = [tookOffice, { name: "SoftFreeze", block: 110n, tx: tx(2) }];
    chain.calls.set(tx(2), call("softFreeze", 1000n));
    chain.failIndex = true;
    const used = await usedNonce(gov, { action: "SoftFreeze", nonce: "0", validUntil: "1000" });
    expect(used.state).toEqual({
      status: "done",
      detail:
        "Nonce 0 was already used; the transaction that used it could not be read now (refresh to retry)",
      txHash: null,
    });
    expect(used.threshold).toBeNull();
  });

  it("is not linked when the transaction is not found, or for a threshold change (no event)", async () => {
    chain.events = [tookOffice, { name: "SoftFreeze", block: 110n, tx: tx(2) }];
    const missing = await usedNonce(gov, { action: "SoftFreeze", nonce: "3", validUntil: "1000" });
    expect(missing.state).toEqual({
      status: "done",
      detail: "Nonce 3 was already used (executed or superseded)",
      txHash: null,
    });
    const threshold = await usedNonce(gov, {
      action: "SetSoftFreezeThreshold",
      nonce: "0",
      validUntil: "1000",
      threshold: "2",
    });
    expect(threshold.state).toMatchObject({ status: "done", txHash: null });
    // Not by this Council at all.
    chain.events = [
      { ...tookOffice, after: OTHER },
      { name: "SoftFreeze", block: 110n, tx: tx(2) },
    ];
    expect(
      (await usedNonce(gov, { action: "SoftFreeze", nonce: "0", validUntil: "1000" })).state
    ).toMatchObject({ txHash: null });
  });
});
