import type { SignatureSet } from "@/.server/signatures";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// executionFor simulates the ready transaction. Its answer may be kept per head only when the
// transaction carries no signature the viewer supplied (?sig=): AGENTS.md says those are stored
// nowhere, and the calldata holds them.

const asked = vi.hoisted(() => [] as { keep?: boolean }[]);

vi.mock("@/.server/signatures", () => ({
  simulate: async (_execution: unknown, options: { keep?: boolean } = {}) => {
    asked.push(options);
    return { status: "ok" };
  },
}));

const { executionFor } = await import("@/.server/flows/common");

const COUNCIL = "0x59195219d1176E42f8e607e9AC114926D47f9035";
const member = (n: number, status: string, source: string | null) => ({
  member: `0x${String(n).repeat(40)}`,
  status,
  source,
  signature: source === null ? null : (`0x0${n}` as Hex),
});

const setOf = (members: ReturnType<typeof member>[]) =>
  ({
    members,
    valid: members
      .filter((m) => m.status === "valid")
      .map((m) => ({ signer: m.member, signature: m.signature })),
    thresholdCheck: { status: "met", checkedWith: "checkSignatures" },
  }) as unknown as SignatureSet;

const build = () =>
  ({ to: COUNCIL, data: "0x1234" as Hex, value: "0", functionName: "f" }) as const;

beforeEach(() => {
  asked.length = 0;
});

describe("executionFor", () => {
  it("keeps the simulation per head when every valid signature came from Safe or the chain", async () => {
    const set = setOf([
      member(1, "valid", "safe"),
      member(2, "valid", "onchain"),
      // A supplied signature that did not verify is not in the transaction.
      member(3, "invalid", "supplied"),
    ]);
    const execution = await executionFor(set, { status: "open" }, build);
    expect(execution?.simulation).toEqual({ status: "ok" });
    expect(asked).toEqual([{ keep: true }]);
  });

  it("never keeps it when a supplied signature is in the transaction", async () => {
    const set = setOf([member(1, "valid", "safe"), member(2, "valid", "supplied")]);
    await executionFor(set, { status: "open" }, build);
    expect(asked).toEqual([{ keep: false }]);
  });

  it("does not simulate a set that is not open or below its threshold", async () => {
    const set = setOf([member(1, "valid", "safe")]);
    expect(await executionFor(set, { status: "closed", detail: "x" }, build)).toBeNull();
    const below = { ...set, thresholdCheck: { status: "below", valid: 1, threshold: 2 } };
    expect(await executionFor(below as SignatureSet, { status: "open" }, build)).toBeNull();
    expect(asked).toEqual([]);
  });
});
