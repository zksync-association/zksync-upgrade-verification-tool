import { clearCache } from "@/.server/cache";
import { UpstreamError } from "@/.server/chain/call";
import type { Lane } from "@/.server/chain/jsonrpc";
import { emergencyUpgradeBoardAbi, guardiansAbi, safeAbi, securityCouncilAbi } from "@/common/abis";
import { safeMessageHashes } from "@/common/safe";
import { type Address, getAddress, zeroHash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContractCall,
  contracts,
  fakeCallLane,
  internalError,
  panicWith,
} from "../support/fake-calls";
import { FakeRpcError } from "../support/fake-jsonrpc";

// governance() and safeInfo(): the reads whose FAILURE decides something (where a member list
// ends, whether a contract has eip712Domain(), whether a member Safe has a threshold). They go out
// through Multicall3 like every other getter; a failed one is asked again directly over the
// l1-call lane, and only the contract's definite revert counts as an answer.

const PUH = getAddress("0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3");
const SC = getAddress("0x59195219d1176E42f8e607e9AC114926D47f9035");
const G = getAddress("0x600dA620Ab29F41ABC6596a15981e14cE58c86b8");
const EUB = getAddress("0xF73a7dCfa68E52030ec39E41a23DCA51F3aAa111");
const ZKF = getAddress("0xbC1653bd3829dfEc575AfC3816D4899cd103B51c");
const member = (group: number, i: number) =>
  getAddress(`0x${group.toString(16)}${(i + 1).toString(16).padStart(39, "0")}`);
const REVERT = Symbol("revert");

const state = vi.hoisted(() => ({
  lane: null as Lane | null,
  memberCount: new Map<string, number>(),
  // `${address}:${functionName}` or `${address}:${functionName}:${arg}`: fails in Multicall3.
  multicallFails: new Set<string>(),
  // Same keys: what the direct eth_call answers instead (a raw JSON-RPC error or a value).
  direct: new Map<string, unknown>(),
  // Getters a contract does not have (they revert, in Multicall3 and directly).
  missing: new Set<string>(),
  directReads: [] as string[],
}));

/** The chain's answer to a getter: a value, or REVERT. */
function onchain(address: Address, functionName: string, args: readonly unknown[]): unknown {
  if (state.missing.has(`${address}:${functionName}`)) return REVERT;
  const domain = (name: string) => ["0x0f", name, "1", 1n, address, zeroHash, []];
  const values: Record<string, Record<string, unknown>> = {
    [PUH]: {
      securityCouncil: SC,
      guardians: G,
      emergencyUpgradeBoard: EUB,
      protocolFrozenUntil: 0n,
      lastFreezeStatusInUpgradeCycle: 0,
    },
    [SC]: {
      EIP1271_THRESHOLD: 9n,
      APPROVE_UPGRADE_SECURITY_COUNCIL_THRESHOLD: 6n,
      softFreezeThreshold: 3n,
      SOFT_FREEZE_CONSERVATIVE_THRESHOLD: 9n,
      HARD_FREEZE_THRESHOLD: 9n,
      UNFREEZE_THRESHOLD: 9n,
      softFreezeNonce: 0n,
      hardFreezeNonce: 0n,
      unfreezeNonce: 0n,
      softFreezeThresholdSettingNonce: 0n,
      PROTOCOL_UPGRADE_HANDLER: PUH,
      eip712Domain: domain("SecurityCouncil"),
    },
    [G]: {
      EIP1271_THRESHOLD: 5n,
      APPROVE_UPGRADE_GUARDIANS_THRESHOLD: 5n,
      EXTEND_LEGAL_VETO_THRESHOLD: 2n,
      CANCEL_L2_GOVERNOR_PROPOSAL_THRESHOLD: 5n,
      nonce: 0n,
      PROTOCOL_UPGRADE_HANDLER: PUH,
      eip712Domain: domain("Guardians"),
    },
    [EUB]: {
      ZK_FOUNDATION_SAFE: ZKF,
      SECURITY_COUNCIL: SC,
      GUARDIANS: G,
      PROTOCOL_UPGRADE_HANDLER: PUH,
      eip712Domain: domain("EmergencyUpgradeBoard"),
    },
  };
  if (functionName === "members") {
    const index = Number(args[0]);
    const count = state.memberCount.get(address) ?? 0;
    return index < count ? member(address === SC ? 0xa : 0xb, index) : REVERT;
  }
  const safe: Record<string, unknown> = {
    VERSION: "1.4.1",
    getThreshold: 2n,
    getOwners: [member(0xc, 0), member(0xc, 1)],
    domainSeparator: safeMessageHashes(1, address, zeroHash).domainHash,
  };
  const value = values[address]?.[functionName] ?? safe[functionName];
  if (value === undefined) throw new Error(`unexpected ${address}.${functionName}`);
  return value;
}

const keysOf = (address: string, functionName: string, args: readonly unknown[]) => [
  `${getAddress(address)}:${functionName}:${args.join(",")}`,
  `${getAddress(address)}:${functionName}`,
];

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    name: "mainnet",
    label: "Ethereum",
    chainId: 1,
    explorerUrl: "",
    l2ExplorerUrl: "",
    tallyUrl: "",
    isDevNode: false,
    overrides: [],
    standardLegalVetoDays: 3,
    safeWalletPrefix: "eth",
    upgradeHandler: PUH,
  }),
  latestBlock: async () => ({ number: 100n, timestamp: 1_000n }),
  safeBlockNumber: async () => 36n,
  lanes: () => ({ call: state.lane }),
  // Multicall3: a failed sub-call says nothing about why it failed.
  l1: {
    getCode: async () => "0x6080",
    readContract: async ({
      address,
      functionName,
      args = [],
    }: { address: Address; functionName: string; args?: readonly unknown[] }) => {
      if (keysOf(address, functionName, args).some((key) => state.multicallFails.has(key)))
        throw new Error("aggregate3 sub-call failed (0x)");
      const value = onchain(getAddress(address), functionName, args);
      if (value === REVERT) throw new Error("aggregate3 sub-call failed (0x)");
      return value;
    },
  },
}));

const { governance, safeInfo } = await import("@/.server/governance");

/** The direct eth_call path: injected answers first, then the chain (a revert as the node says it). */
function direct(call: ContractCall): unknown {
  state.directReads.push(`${getAddress(call.to)}:${call.functionName}:${call.args.join(",")}`);
  for (const key of keysOf(call.to, call.functionName, call.args))
    if (state.direct.has(key)) return state.direct.get(key);
  const value = onchain(getAddress(call.to), call.functionName, call.args);
  if (value !== REVERT) return value;
  return call.functionName === "members"
    ? panicWith(0x32n)
    : new FakeRpcError(3, "execution reverted", "0x");
}

beforeEach(() => {
  clearCache();
  state.memberCount = new Map([
    [SC, 3],
    [G, 2],
  ]);
  state.multicallFails.clear();
  state.direct.clear();
  state.missing.clear();
  state.directReads = [];
  state.lane = fakeCallLane(
    contracts({
      abis: [securityCouncilAbi, guardiansAbi, emergencyUpgradeBoardAbi, safeAbi],
      call: direct,
    })
  ).lane;
});

describe("member lists", () => {
  it("end where members(i) definitely reverts (Panic 0x32), confirmed directly", async () => {
    const gov = await governance();
    expect(gov.securityCouncil.members).toEqual([0, 1, 2].map((i) => member(0xa, i)));
    expect(gov.guardians.members).toEqual([0, 1].map((i) => member(0xb, i)));
    expect(gov.warnings).toEqual([]);
    // Only the first failed Multicall3 read of each list was asked again directly: past the
    // end every read fails, and one definite revert is enough.
    const memberReads = state.directReads.filter((read) => read.includes(":members:"));
    expect(memberReads.sort()).toEqual([`${SC}:members:3`, `${G}:members:2`].sort());
  });

  it("keep a member whose Multicall3 read failed (e.g. out of gas) but whose direct read answers", async () => {
    state.multicallFails.add(`${SC}:members:1`);
    const gov = await governance();
    expect(gov.securityCouncil.members).toHaveLength(3);
    expect(state.directReads).toContain(`${SC}:members:1`);
  });

  it.each([
    ["a member's direct read fails", `${SC}:members:1`, true],
    ["the read past the end fails instead of reverting", `${G}:members:2`, false],
  ])("fail instead of shortening the list when %s (-32603)", async (_, key, viaMulticall) => {
    state.direct.set(key, internalError());
    if (viaMulticall) state.multicallFails.add(key);
    await expect(governance()).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("eip712Domain()", () => {
  it("falls back to the assumed domain, with today's warning, only on a definite revert", async () => {
    state.missing.add(`${EUB}:eip712Domain`);
    const gov = await governance();
    expect(gov.emergencyUpgradeBoard.domain).toEqual({
      name: "EmergencyUpgradeBoard",
      version: "1",
      chainId: 1,
      verifyingContract: EUB,
    });
    expect(gov.warnings).toEqual([
      `EmergencyUpgradeBoard at ${EUB} has no eip712Domain(); assuming ("EmergencyUpgradeBoard", "1")`,
    ]);
  });

  it("fails on an RPC failure instead of assuming a domain", async () => {
    state.multicallFails.add(`${SC}:eip712Domain`);
    state.direct.set(`${SC}:eip712Domain`, internalError());
    await expect(governance()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("reads the domain directly when only the Multicall3 read failed", async () => {
    state.multicallFails.add(`${G}:eip712Domain`);
    const gov = await governance();
    expect(gov.guardians.domain.name).toBe("Guardians");
    expect(gov.warnings).toEqual([]);
  });
});

describe("safeInfo", () => {
  const safe = member(0xd, 0);

  it("reads a Safe's version, threshold, owners and domain separator", async () => {
    expect(await safeInfo(safe)).toEqual({
      address: safe,
      isContract: true,
      version: "1.4.1",
      threshold: 2,
      owners: [member(0xc, 0), member(0xc, 1)],
      domainSeparatorMatches: true,
    });
  });

  it("reads a getter the contract does not have (a definite revert) as null", async () => {
    state.missing.add(`${safe}:getThreshold`);
    state.missing.add(`${safe}:getOwners`);
    expect(await safeInfo(safe)).toMatchObject({ threshold: null, owners: [], version: "1.4.1" });
  });

  it("fails on an RPC failure instead of losing the threshold", async () => {
    // A lost threshold would turn a Safe still collecting signatures into an invalid one.
    state.multicallFails.add(`${safe}:getThreshold`);
    state.direct.set(`${safe}:getThreshold`, internalError());
    await expect(safeInfo(safe)).rejects.toBeInstanceOf(UpstreamError);
  });
});
