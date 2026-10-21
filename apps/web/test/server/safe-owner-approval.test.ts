import { beforeEach, expect, it, vi } from "vitest";
import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeFunctionResult,
  pad,
  zeroAddress,
  zeroHash,
} from "viem";
import { safeAbi, safeSignMessageLibAbi } from "@/common/abis";
import { SAFE_OWNER_APPROVAL, safeOwnerMessageCall } from "@/common/safe-owner-approval";
import { safeMessageHashes } from "@/common/safe";
import { buildTypedData, governanceHashes } from "@/common/typed-data";
import runtime from "../fixtures/safe-owner-runtime.json";

// Isolate the existing RPC/status/index boundaries. The real ABI encoders, hash functions,
// published runtime bytes, owner policy checks and Safe transaction builder run unchanged.
const reads = vi.hoisted(() => ({
  net: {} as any,
  status: {} as any,
  upgrade: {} as any,
  values: {} as Record<string, unknown>,
  code: "",
  library: "",
  result: true,
  calls: [] as any[],
}));
vi.mock("@/.server/rpc", () => ({
  network: async () => reads.net,
  refreshHead: async () => {},
  latestBlock: async () => ({ number: 100n }),
  l1: {
    getCode: async ({ address }: any) =>
      address === SAFE_OWNER_APPROVAL.library ? reads.library : reads.code,
    getStorageAt: async ({ slot }: any) =>
      pad(
        slot === zeroHash
          ? reads.net.codePins.safeSingleton
          : reads.net.codePins.safeFallbackHandler,
        { size: 32 }
      ),
  },
}));
vi.mock("@/.server/status", () => ({ appStatus: async () => reads.status }));
vi.mock("@/.server/flows/standard", () => ({ getStandardUpgradeCore: async () => reads.upgrade }));
vi.mock("@/.server/chain/call", () => ({
  callFn: async ({ functionName }: any) => reads.values[functionName],
  ethCall: async (request: any) => {
    reads.calls.push(request);
    return encodeFunctionResult({
      abi: safeAbi,
      functionName: "execTransaction",
      result: reads.result,
    });
  },
}));
import { prepareSafeOwnerApproval } from "@/.server/safe-owner-approval";

const safe = "0x134Cf18eC62e2D42c708A8b6E7476bF4d15E9532" as Address;
const owner = "0xeC6A5c568A59C0858ed6680A6862d64aA2DA8D4b" as Address;
const id = `0x${"ab".repeat(32)}` as Hex;
const domain = {
  name: "SecurityCouncil",
  version: "1",
  chainId: 11155111,
  verifyingContract: "0x2498CAc75FA29b5c30e126C23ABcCc5ac5119821" as Address,
};
beforeEach(() => {
  reads.net = {
    chainId: 11155111,
    upgradeHandler: SAFE_OWNER_APPROVAL.handler,
    codePins: {
      safeProxy: "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
      safeSingleton: "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA",
      safeFallbackHandler: "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804",
    },
  };
  reads.status = {
    ok: true,
    governance: { warnings: [], network: { overrides: [] } },
    logHistory: { status: "ok" },
    sync: { cache: { state: "ready" } },
  };
  reads.upgrade = {
    started: { idMatches: true },
    state: 2,
    status: { securityCouncilApprovalTimestamp: 0 },
    governance: { securityCouncil: { members: [safe], domain } },
  };
  const digest = governanceHashes(
    buildTypedData("ApproveUpgradeSecurityCouncil", domain, { id })
  ).digest;
  reads.values = {
    getOwners: [owner],
    getThreshold: 1n,
    VERSION: "1.3.0",
    domainSeparator: safeMessageHashes(11155111, safe, digest).domainHash,
    signedMessages: 0n,
  };
  reads.code = runtime.safe;
  reads.library = runtime.library;
  reads.result = true;
  reads.calls = [];
});

it("builds and simulates an exact zero-value Safe message approval from its sole owner", async () => {
  const plan = await prepareSafeOwnerApproval(id, safe, owner);
  expect(plan).toMatchObject({
    safe,
    owner,
    chainId: 11155111,
    alreadyApproved: false,
    value: "0",
    checkedAtBlock: "100",
  });
  const decoded = decodeFunctionData({ abi: safeAbi, data: plan.data });
  expect(decoded.functionName).toBe("execTransaction");
  expect(decoded.args.slice(0, 2)).toEqual([SAFE_OWNER_APPROVAL.library, 0n]);
  expect(
    decodeFunctionData({ abi: safeSignMessageLibAbi, data: decoded.args[2] as Hex }).args
  ).toEqual([plan.digest]);
  expect(decoded.args.slice(3, 9)).toEqual([1, 0n, 0n, 0n, zeroAddress, zeroAddress]);
  expect(decoded.args[9]).toBe(`${pad(owner, { size: 32 })}${zeroHash.slice(2)}01`.toLowerCase());
  expect(reads.calls).toEqual([
    { from: owner, to: safe, data: plan.data, value: 0n, blockNumber: 100n },
  ]);
});

it.each([
  [
    "mainnet",
    () => {
      reads.net.chainId = 1;
    },
    /only.*Testnet 3/,
  ],
  [
    "another handler",
    () => {
      reads.net.upgradeHandler = safe;
    },
    /only.*Testnet 3/,
  ],
  [
    "non-member Safe",
    () => {
      reads.upgrade.governance.securityCouncil.members = [];
    },
    /not a current.*member/,
  ],
  [
    "wrong owner",
    () => {
      reads.values.getOwners = [safe];
    },
    /sole owner/,
  ],
  [
    "multiple owners",
    () => {
      reads.values.getOwners = [owner, safe];
    },
    /sole owner/,
  ],
  [
    "higher threshold",
    () => {
      reads.values.getThreshold = 2n;
    },
    /sole owner/,
  ],
  [
    "closed upgrade",
    () => {
      reads.upgrade.state = 4;
    },
    /not awaiting/,
  ],
  [
    "altered proposal",
    () => {
      reads.upgrade.started.idMatches = false;
    },
    /not awaiting/,
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
    "changed Safe runtime",
    () => {
      reads.code = "0x00";
    },
    /Safe proxy/,
  ],
  [
    "changed library runtime",
    () => {
      reads.library = "0x00";
    },
    /SignMessageLib runtime/,
  ],
  [
    "incorrect domain",
    () => {
      reads.values.domainSeparator = zeroHash;
    },
    /domain separator/,
  ],
  [
    "failed inner execution",
    () => {
      reads.result = false;
    },
    /simulation returned false/,
  ],
] as const)("rejects %s before producing an approval plan", async (_label, _change, _reason) => {
  _change();
  await expect(prepareSafeOwnerApproval(id, safe, owner)).rejects.toThrow(_reason);
});

it("recognizes an already approved message without offering another execution", async () => {
  reads.values.signedMessages = 1n;
  expect((await prepareSafeOwnerApproval(id, safe, owner)).alreadyApproved).toBe(true);
  expect(reads.calls).toEqual([]);
});

it("binds approval calldata to the precise member Safe and governance digest", () => {
  const first = safeOwnerMessageCall(safe, owner, id);
  expect(safeOwnerMessageCall(owner, owner, id).safeMessageHash).not.toBe(first.safeMessageHash);
  expect(safeOwnerMessageCall(safe, owner, zeroHash).data).not.toBe(first.data);
});
