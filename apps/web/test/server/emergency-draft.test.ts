import type { Lane } from "@/.server/chain/jsonrpc";
import { type Address, getAddress } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import { fakeCallLane, internalError, outOfGas, revertWith } from "../support/fake-calls";
import { FakeRpcError } from "../support/fake-jsonrpc";

// The proposer's draft check on /app/emergency/new: each call as an eth_call from the
// ProtocolUpgradeHandler. "reverts" only on the node's definite revert; an RPC failure is "could
// not check", never a revert.

const PUH = getAddress("0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3");
const TARGET: Address = "0x000000000000000000000000000000000000dEaD";

const state = vi.hoisted(() => ({ lane: null as Lane | null }));
vi.mock("@/.server/rpc", () => ({
  lanes: () => ({ call: state.lane }),
  network: async () => ({ chainId: 1, isDevNode: false }),
}));
vi.mock("@/.server/governance", () => ({
  governance: async () => ({ upgradeHandler: PUH }),
}));

const { checkDraftCalls } = await import("@/.server/flows/emergency-draft");

let reply: (index: number) => unknown;
let calls: ReturnType<typeof fakeCallLane>["calls"];

beforeEach(() => {
  reply = () => "0x";
  const fake = fakeCallLane((call) => {
    const tx = call.params[0] as { data: string };
    return reply(Number.parseInt(tx.data.slice(2) || "0", 16));
  });
  state.lane = fake.lane;
  calls = fake.calls;
});

const draft = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    target: TARGET,
    value: BigInt(i),
    data: `0x0${i}` as const,
  }));

it("sends each call from the ProtocolUpgradeHandler with its value", async () => {
  expect(await checkDraftCalls(draft(2))).toEqual([{ ok: true }, { ok: true }]);
  expect(calls().map((c) => c.params)).toEqual([
    [{ to: TARGET, data: "0x00", from: PUH, value: "0x0" }, "latest"],
    [{ to: TARGET, data: "0x01", from: PUH, value: "0x1" }, "latest"],
  ]);
});

it("reports a revert only for a definite revert, and an RPC failure as unchecked", async () => {
  const answers = [
    revertWith("Ownable: caller is not the owner"),
    new FakeRpcError(-32000, "execution reverted"),
    internalError(),
    outOfGas(),
    new FakeRpcError(-32005, "request rate exceeded"),
  ];
  reply = (index) => answers[index];
  const results = await checkDraftCalls(draft(answers.length));
  expect(results.slice(0, 2)).toEqual([
    { ok: false, error: "Ownable: caller is not the owner" },
    { ok: false, error: "execution reverted" },
  ]);
  for (const result of results.slice(2)) {
    expect(result).toMatchObject({ ok: null, skipped: expect.stringMatching(/^RPC error: /) });
  }
});

it("reports an HTTP failure as unchecked, never as a revert", async () => {
  const fake = fakeCallLane(() => "0x", {
    intercept: () => new Response("Too Many Requests", { status: 429 }),
  });
  state.lane = fake.lane;
  const [result] = await checkDraftCalls(draft(1));
  expect(result).toMatchObject({ ok: null });
});
