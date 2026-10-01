import { getEmergencyUpgrade } from "@/.server/flows/emergency";
import { getStandardUpgrade } from "@/.server/flows/standard";
import { getLogs } from "@/.server/logs";
import { l1, network } from "@/.server/rpc";
import { upgradeHandlerAbi } from "@/common/abis";
import { approvalExecution } from "@/common/execution";
import { upgradeProposalId } from "@/common/proposal";
import { toEventSelector, getAbiItem, type Hex, decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

// The brief's evidence, checked through the same code the pages use. Read-only: eth_call,
// eth_getLogs and Safe Transaction Service GETs. Nothing is signed or sent.

const UPGRADE_ID: Hex = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa";
const APPROVAL_TX: Hex = "0x1defa4f7f06a4c8a5066ea56f2a27b00a2beeb016cec336692e39460c3f55e11";

describe("mainnet, read-only", () => {
  it("resolves mainnet from the RPC's chain id with no overrides", async () => {
    const net = await network();
    expect(net.chainId).toBe(1);
    expect(net.upgradeHandler).toBe("0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3");
    expect(net.overrides).toEqual([]);
  });

  it(`upgrade ${UPGRADE_ID.slice(0, 10)}…: 7 of 8 Security Council Safes signed, all accepted by checkSignatures`, async () => {
    const detail = await getStandardUpgrade(UPGRADE_ID);
    expect(detail.started.blockNumber).toBe("26050400");
    expect(detail.started.idMatches).toBe(true);
    expect(upgradeProposalId(detail.started.proposal)).toBe(UPGRADE_ID);

    const council = detail.sets.find((s) => s.key === "securityCouncil");
    if (!council) throw new Error("no council set");
    expect(council.set.members).toHaveLength(8);
    expect(council.set.threshold).toBe(4);
    const valid = council.set.members.filter((m) => m.status === "valid");
    expect(valid).toHaveLength(7);
    expect(valid.every((m) => m.source === "safe")).toBe(true);
    expect(council.set.members.filter((m) => m.status === "missing").map((m) => m.member)).toEqual([
      "0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a",
    ]);
    expect(council.set.thresholdCheck.status).toBe("met");
  });

  it(`approval tx ${APPROVAL_TX.slice(0, 10)}… used 6 signatures, byte-identical to Safe's`, async () => {
    const detail = await getStandardUpgrade(UPGRADE_ID);
    const council = detail.sets.find((s) => s.key === "securityCouncil");
    if (!council || council.state.status !== "done") throw new Error("approval not found");
    expect(council.state.txHash).toBe(APPROVAL_TX);
    expect(council.used).toHaveLength(6);
    expect(council.used?.every((u) => u.matchesSafe === true)).toBe(true);
    // The contract accepted exactly these signatures in the block before the approval.
    expect(council.historical?.accepted).toBe(true);

    // Rebuilding the calldata from Safe's copies of those six signers reproduces the inner call.
    const usedSigners = new Set(council.used?.map((u) => u.signer));
    const rebuilt = approvalExecution(
      "ApproveUpgradeSecurityCouncil",
      detail.governance.securityCouncil.address,
      UPGRADE_ID,
      council.set.valid.filter((s) => usedSigners.has(s.signer))
    );
    const tx = await l1.getTransaction({ hash: APPROVAL_TX });
    const execTransaction = parseAbi([
      "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
    ]);
    const inner = decodeFunctionData({ abi: execTransaction, data: tx.input }).args[2];
    expect(rebuilt.data).toBe(inner);
  });

  it("emergency upgrades executed in blocks 25711037–25766164 rebuild to the ids members signed in Safe", async () => {
    const net = await network();
    const topic = toEventSelector(
      getAbiItem({ abi: upgradeHandlerAbi, name: "EmergencyUpgradeExecuted" })
    );
    const logs = await getLogs(
      l1,
      { address: net.upgradeHandler, topics: [topic] },
      25_711_037n,
      25_766_164n
    );
    expect(logs).toHaveLength(6);

    for (const log of logs) {
      const id = log.topics[1] as Hex;
      const detail = await getEmergencyUpgrade(id);
      const executed = detail.executed;
      if (!executed) throw new Error(`no execution decoded for ${id}`);
      expect(executed.txHash).toBe(log.transactionHash);
      // calls + salt from the calldata, executor = the board → keccak256 → the executed id.
      expect(executed.idMatches).toBe(true);
      expect(upgradeProposalId(executed.proposal)).toBe(id);

      // The same id is what council and guardian members signed in their Safes, and the
      // signatures the execution used are byte-identical to Safe's copies.
      for (const role of detail.roles.filter((r) => r.key !== "zkFoundation")) {
        const signedInSafe = role.set.members.filter((m) => m.source === "safe");
        expect(signedInSafe.length).toBeGreaterThanOrEqual(role.set.threshold);
        expect(role.set.typedData.message.id).toBe(id.toLowerCase());
        expect(role.used?.length).toBeGreaterThanOrEqual(role.set.threshold);
        expect(role.used?.every((u) => u.matchesSafe === true)).toBe(true);
      }
      // All three of EmergencyUpgradeBoard's checks accept the used signatures before execution.
      expect(executed.historical?.checks.every((c) => c.accepted)).toBe(true);
    }
  });
});
