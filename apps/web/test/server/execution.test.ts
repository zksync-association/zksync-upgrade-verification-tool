import { emergencyUpgradeBoardAbi, securityCouncilAbi } from "@/common/abis";
import {
  approvalExecution,
  cancelL2Execution,
  emergencyExecution,
  freezeExecution,
  sortBySigner,
} from "@/common/execution";
import {
  checkEmergencyPayload,
  decodeCall,
  decodeUpgradeProposal,
  encodeUpgradeProposal,
  upgradeProposalId,
} from "@/common/proposal";
import { type Hex, decodeAbiParameters, decodeFunctionData, getAddress, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_TX,
  EMERGENCY_ID,
  EMERGENCY_TX,
  MAINNET,
  TRANSACTIONS,
  UPGRADE_ID,
  messagesFor,
} from "../support/fixtures";

const execTransaction = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
]);

const safeSignatures = (primaryType: string, id: Hex) =>
  messagesFor(primaryType, id).map((m) => ({
    signer: getAddress(m.safe),
    signature: m.preparedSignature as Hex,
  }));

describe("approval calldata", () => {
  it("rebuilds the Security Council approval in tx 0x1defa4f7… from Safe's signatures, byte for byte", () => {
    const tx = TRANSACTIONS[APPROVAL_TX];
    if (!tx) throw new Error("fixture missing");
    const inner = decodeFunctionData({ abi: execTransaction, data: tx.input }).args[2];
    const { args } = decodeFunctionData({ abi: securityCouncilAbi, data: inner });
    const used = new Set((args[1] as readonly string[]).map((a) => getAddress(a)));

    const fromSafe = safeSignatures("ApproveUpgradeSecurityCouncil", UPGRADE_ID);
    expect(fromSafe).toHaveLength(7);
    const rebuilt = approvalExecution(
      "ApproveUpgradeSecurityCouncil",
      MAINNET.securityCouncil,
      UPGRADE_ID,
      fromSafe.filter((s) => used.has(s.signer))
    );
    expect(rebuilt.to).toBe(MAINNET.securityCouncil);
    expect(rebuilt.data).toBe(inner);
  });

  it("orders signers ascending, as checkSignatures requires", () => {
    const sigs = [
      { signer: "0xFB90Da9DC45378A1B50775Beb03aD10C7E8DC231", signature: "0x01" },
      { signer: "0x35eA56fd9eAd2567F339Eb9564B6940b9DD5653F", signature: "0x02" },
      { signer: "0x84BF0Ac41Eeb74373Ddddae8b7055Bf2bD3CE6E0", signature: "0x03" },
    ] as const;
    expect(sortBySigner([...sigs]).map((s) => s.signature)).toEqual(["0x02", "0x03", "0x01"]);
  });
});

describe("emergency calldata", () => {
  const tx = TRANSACTIONS[EMERGENCY_TX];
  if (!tx) throw new Error("fixture missing");
  const args = decodeFunctionData({ abi: emergencyUpgradeBoardAbi, data: tx.input })
    .args as unknown as readonly [
    readonly { target: Hex; value: bigint; data: Hex }[],
    Hex,
    Hex,
    Hex,
    Hex,
  ];
  const [calls, salt] = args;
  const payload = {
    salt,
    calls: calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
  };

  it("rebuilds calls + salt from the execution and hashes them to the executed id", () => {
    const check = checkEmergencyPayload(payload, EMERGENCY_ID, MAINNET.emergencyUpgradeBoard);
    expect(check.ok).toBe(true);
  });

  it("rebuilds the whole executeEmergencyUpgrade call from Safe's signatures, byte for byte", () => {
    const check = checkEmergencyPayload(payload, EMERGENCY_ID, MAINNET.emergencyUpgradeBoard);
    if (!check.ok) throw new Error(check.error);
    const council = safeSignatures("ExecuteEmergencyUpgradeSecurityCouncil", EMERGENCY_ID);
    const guardians = safeSignatures("ExecuteEmergencyUpgradeGuardians", EMERGENCY_ID);
    const [foundation] = safeSignatures("ExecuteEmergencyUpgradeZKFoundation", EMERGENCY_ID);
    if (!foundation) throw new Error("fixture missing");
    // Only the signers the executor used (Safe may hold more).
    const usedOf = (blob: Hex) =>
      new Set(
        decodeAbiParameters([{ type: "address[]" }, { type: "bytes[]" }], blob)[0].map((a) =>
          getAddress(a)
        )
      );
    const usedGuardians = usedOf(args[2]);
    const usedCouncil = usedOf(args[3]);
    const rebuilt = emergencyExecution(
      MAINNET.emergencyUpgradeBoard,
      check.proposal,
      guardians.filter((g) => usedGuardians.has(g.signer)),
      council.filter((c) => usedCouncil.has(c.signer)),
      foundation.signature
    );
    expect(rebuilt.data).toBe(tx.input);
  });

  it("rejects a payload that does not hash to the signed id, or names another executor", () => {
    const tampered = {
      ...payload,
      calls: payload.calls.map((c, i) => (i === 0 ? { ...c, value: "1" } : c)),
    };
    const result = checkEmergencyPayload(tampered, EMERGENCY_ID, MAINNET.emergencyUpgradeBoard);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/not to the signed id/);
    const otherExecutor = checkEmergencyPayload(
      { ...payload, executor: MAINNET.securityCouncil },
      EMERGENCY_ID,
      MAINNET.emergencyUpgradeBoard
    );
    expect(otherExecutor.ok ? "" : otherExecutor.error).toMatch(/not the Emergency Upgrade Board/);
    expect(
      checkEmergencyPayload(
        { salt: "0x12", calls: [] },
        EMERGENCY_ID,
        MAINNET.emergencyUpgradeBoard
      ).ok
    ).toBe(false);
  });
});

describe("proposal encoding", () => {
  const proposal = {
    calls: [
      {
        target: getAddress("0xC2a36181fB524a6bEfE639aFEd37A67e77d62cf1"),
        value: "0",
        data: "0x99a88ec40000000000000000000000002e5110cf18678ec99818bfaa849b8c881744b776000000000000000000000000556ddc1617d7620f56317d2f2002fe440ea9ad35" as Hex,
      },
    ],
    executor: getAddress("0x0000000000000000000000000000000000000000"),
    salt: `0x${"00".repeat(32)}` as Hex,
  };

  it("hashes upgrade 0x77d5… from its content", () => {
    expect(upgradeProposalId(proposal)).toBe(UPGRADE_ID);
    expect(decodeUpgradeProposal(encodeUpgradeProposal(proposal))).toEqual(proposal);
  });

  it("decodes known calls only when re-encoding reproduces the calldata", () => {
    const decoded = decodeCall(proposal.calls[0] as (typeof proposal.calls)[number]);
    expect(decoded.decoded?.signature).toBe("upgrade(address,address)");
    expect(decoded.decoded?.args.map((a) => a.name)).toEqual(["proxy", "implementation"]);
    const trailing = decodeCall({
      ...(proposal.calls[0] as (typeof proposal.calls)[number]),
      data: `${proposal.calls[0]?.data}00` as Hex,
    });
    expect(trailing.decoded).toBeNull();
    expect(
      decodeCall({ target: proposal.executor, value: "0", data: "0xdeadbeef" }).decoded
    ).toBeNull();
  });
});

describe("CLI upgrade file", () => {
  it("is what apps/cli parses, and hashes to the same id", async () => {
    const { upgradeFileJson } = await import("@/components/verification/upgrade-file");
    const { calculateUpgradeProposalHash } = await import("@repo/common/util");
    const proposal = {
      calls: [
        {
          target: getAddress("0xC2a36181fB524a6bEfE639aFEd37A67e77d62cf1"),
          value: "16",
          data: "0x1234" as Hex,
        },
      ],
      executor: getAddress("0x0000000000000000000000000000000000000000"),
      salt: `0x${"00".repeat(32)}` as Hex,
    };
    const file = JSON.parse(upgradeFileJson(proposal));
    expect(file.calls[0].value).toBe("0x10");
    expect(calculateUpgradeProposalHash(file.calls, file.salt, file.executor)).toBe(
      upgradeProposalId(proposal)
    );
  });
});

describe("freeze and veto calldata", () => {
  const sigs = [
    { signer: getAddress("0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a"), signature: "0xaa" as Hex },
  ];

  it("passes validUntil (and the threshold) but not the nonce, which the contract reads itself", () => {
    const soft = freezeExecution(
      "SoftFreeze",
      MAINNET.securityCouncil,
      { validUntil: "1790000000" },
      sigs
    );
    const { functionName, args } = decodeFunctionData({ abi: securityCouncilAbi, data: soft.data });
    expect(functionName).toBe("softFreeze");
    expect(args).toEqual([1790000000n, [sigs[0]?.signer], ["0xaa"]]);
    const threshold = freezeExecution(
      "SetSoftFreezeThreshold",
      MAINNET.securityCouncil,
      { validUntil: "1", threshold: "2" },
      sigs
    );
    expect(
      decodeFunctionData({ abi: securityCouncilAbi, data: threshold.data }).args?.slice(0, 2)
    ).toEqual([2n, 1n]);
  });

  it("sends txMintValue with the veto", () => {
    const veto = cancelL2Execution(
      MAINNET.guardians,
      { targets: [MAINNET.guardians], values: ["0"], calldatas: ["0x"], description: "d" },
      {
        to: getAddress("0xb83FF6501214ddF40C91C9565d095400f3F45746"),
        l2GasLimit: "30000000",
        l2GasPerPubdataByteLimit: "800",
        refundRecipient: MAINNET.guardians,
        txMintValue: "20000000000000000",
      },
      sigs
    );
    expect(veto.value).toBe("20000000000000000");
    expect(veto.functionName).toBe("cancelL2GovernorProposal");
  });
});
