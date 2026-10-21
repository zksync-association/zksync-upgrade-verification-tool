import { beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, zeroHash, zeroAddress, type Address, type Hex } from "viem";
import { CHAIN_UPGRADE, protocolVersionLabel } from "@/common/chain-upgrade";
import {
  chainUpgradeAdminAbi,
  chainUpgradeNotifierAbi,
  chainUpgradeDiamondAbi,
  chainUpgradeLegacyDiamondAbi,
} from "@/common/abis";
import fixture from "../fixtures/chain-upgrade.json";
// Isolate transport, indexing/status and wallet boundaries; use the actual registered v33 cut
// and ChainAdmin runtime. Real ABI encoding, hashing and the permission/time gates run unchanged.
const reads = vi.hoisted(() => ({
  net: {} as any,
  status: {} as any,
  values: {} as Record<string, unknown>,
  code: "",
  logs: [] as any[],
  calls: [] as any[],
  gas: 200_000n,
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => reads.net,
  refreshHead: async () => {},
  latestBlock: async () => ({ number: 11965313n, timestamp: 1792620816n }),
  l1: {
    getCode: async () => reads.code,
    getContractEvents: async () => reads.logs,
    estimateGas: async () => reads.gas,
    getBlock: async () => ({ gasLimit: 30_000_000n }),
  },
}));
vi.mock("@/.server/status", () => ({ appStatus: async () => reads.status }));
vi.mock("@/.server/chain/call", () => ({
  callFn: async ({ functionName }: any) => reads.values[functionName],
  ethCall: async (_request: any) => {
    reads.calls.push(_request);
    return "0x";
  },
}));
vi.mock("@/.server/safe-owner-receipt", () => ({
  readSafeOwnerReceipt: async () => ({ status: "reverted", hash: zeroHash }),
}));
import { loadChainUpgrade, prepareChainUpgrade } from "@/.server/flows/chain-upgrade";
const s = fixture.state;
const owner = s.owner as Address;
const forwarded = (_data: Hex) => {
  const decoded = decodeFunctionData({ abi: chainUpgradeAdminAbi, data: _data });
  if (decoded.functionName !== "multicall") throw new Error("Expected admin multicall");
  const call = decoded.args[0][0];
  if (!call) throw new Error("Missing forwarded call");
  return { call, requireSuccess: decoded.args[1] };
};
beforeEach(() => {
  reads.net = { chainId: 11155111, upgradeHandler: CHAIN_UPGRADE.handler };
  reads.status = {
    ok: true,
    governance: { warnings: [], network: { overrides: [] } },
    logHistory: { status: "ok" },
    sync: { cache: { state: "verified" } },
  };
  reads.values = {
    getZKChain: s.diamond,
    chainTypeManager: s.ctm,
    getChainTypeManager: s.ctm,
    getAdmin: s.admin,
    getChainId: 312n,
    getProtocolVersion: BigInt(s.currentVersion),
    owner: s.owner,
    protocolVersion: BigInt(s.targetVersion),
    serverNotifierAddress: s.notifier,
    upgradeCutHash: s.cutHash,
    upgradeCutDataBlock: BigInt(s.cutBlock),
    protocolVersionToUpgradeTimestamp: 0n,
  };
  reads.code = fixture.adminCode;
  reads.logs = [
    {
      args: { protocolVersion: BigInt(s.currentVersion), diamondCutData: fixture.cut },
      transactionHash: s.cutSourceTransaction,
    },
  ];
  reads.calls = [];
  reads.gas = 200_000n;
});
it("reads chain/admin identity and verifies the registered cut against its on-chain hash", async () => {
  const { state, cut } = await loadChainUpgrade(312n);
  expect(state).toMatchObject({
    chainId: "312",
    owner,
    currentVersion: s.currentVersion,
    targetVersion: s.targetVersion,
    cutHash: s.cutHash,
    timestamp: "0",
  });
  expect(cut).toEqual(fixture.cut);
  expect(reads.calls).toEqual([]);
  expect(protocolVersionLabel(state.currentVersion)).toBe("v0.31.1");
  expect(protocolVersionLabel(state.targetVersion)).toBe("v0.33.0");
});
it("prepares a zero-value atomic admin call to set this chain's timestamp", async () => {
  const plan = await prepareChainUpgrade(312n, "timestamp", owner, 1792620816n);
  const outer = forwarded(plan.data);
  expect(outer.requireSuccess).toBe(true);
  expect(outer.call.target).toBe(s.notifier);
  expect(outer.call.value).toBe(0n);
  expect(decodeFunctionData({ abi: chainUpgradeNotifierAbi, data: outer.call.data }).args).toEqual([
    312n,
    1792620816n,
  ]);
  expect(plan.gasLimit).toBe("800000");
  expect(reads.calls).toMatchObject([{ from: owner, to: s.admin, data: plan.data, value: 0n }]);
});
it("requires the timestamp to be recorded and reached before preparing execution", async () => {
  await expect(prepareChainUpgrade(312n, "execute", owner)).rejects.toThrow(/timestamp first/);
  reads.values.protocolVersionToUpgradeTimestamp = 1792620817n;
  await expect(prepareChainUpgrade(312n, "execute", owner)).rejects.toThrow(/has not arrived/);
  expect(reads.calls).toEqual([]);
  reads.values.protocolVersionToUpgradeTimestamp = 1792620816n;
  const plan = await prepareChainUpgrade(312n, "execute", owner);
  const outer = forwarded(plan.data);
  const inner = decodeFunctionData({
    abi: chainUpgradeDiamondAbi,
    data: outer.call.data,
  });
  expect(inner.args).toEqual([s.diamond, BigInt(s.currentVersion), fixture.cut]);
});
it("uses the legacy two-argument ABI on a pre-v31 chain", async () => {
  reads.values.getProtocolVersion = 30n << 32n;
  reads.values.protocolVersionToUpgradeTimestamp = 1n;
  const plan = await prepareChainUpgrade(312n, "execute", owner);
  const outer = forwarded(plan.data);
  expect(
    decodeFunctionData({ abi: chainUpgradeLegacyDiamondAbi, data: outer.call.data }).args
  ).toEqual([30n << 32n, fixture.cut]);
});
it("marks an upgraded chain complete and prepares no duplicate execution", async () => {
  reads.values.getProtocolVersion = BigInt(s.targetVersion);
  expect((await loadChainUpgrade(312n)).state.completed).toBe(true);
  await expect(prepareChainUpgrade(312n, "execute", owner)).rejects.toThrow(/already on/);
  expect(reads.calls).toEqual([]);
});
it.each([
  [
    "mainnet",
    () => {
      reads.net.chainId = 1;
    },
    /Sepolia/,
  ],
  [
    "another CTM",
    () => {
      reads.values.chainTypeManager = owner;
    },
    /different CTM/,
  ],
  [
    "unregistered chain",
    () => {
      reads.values.getZKChain = zeroAddress;
    },
    /not registered/,
  ],
  [
    "wrong chain identity",
    () => {
      reads.values.getChainId = 313n;
    },
    /identity disagree/,
  ],
  [
    "unsupported admin",
    () => {
      reads.code = "0x00";
    },
    /ChainAdminOwnable/,
  ],
  [
    "governance warning",
    () => {
      reads.status.governance.warnings = ["Changed code"];
    },
    /require attention/,
  ],
  [
    "incomplete history",
    () => {
      reads.status.logHistory.status = "unavailable";
    },
    /require attention/,
  ],
  [
    "cache mismatch",
    () => {
      reads.status.sync.cache.state = "mismatch";
    },
    /require attention/,
  ],
  [
    "missing cut",
    () => {
      reads.values.upgradeCutHash = zeroHash;
    },
    /has not registered/,
  ],
  [
    "altered cut",
    () => {
      reads.logs[0].args.diamondCutData = { ...fixture.cut, initAddress: owner };
    },
    /does not uniquely match/,
  ],
  [
    "ambiguous cut",
    () => {
      reads.logs.push(reads.logs[0]);
    },
    /does not uniquely match/,
  ],
] as const)("blocks %s before simulation", async (_name, _change, _reason) => {
  _change();
  await expect(prepareChainUpgrade(312n, "timestamp", owner, 1n)).rejects.toThrow(_reason);
  expect(reads.calls).toEqual([]);
});
it("blocks the wrong owner and zero timestamp", async () => {
  await expect(prepareChainUpgrade(312n, "timestamp", s.admin as Address, 1n)).rejects.toThrow(
    /current ChainAdmin owner/
  );
  await expect(prepareChainUpgrade(312n, "timestamp", owner, 0n)).rejects.toThrow(
    /positive upgrade timestamp/
  );
});
