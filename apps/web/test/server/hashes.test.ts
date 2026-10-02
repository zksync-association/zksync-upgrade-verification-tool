import { recoverSafeOwners, safeMessageHashes } from "@/common/safe";
import {
  buildTypedData,
  governanceHashes,
  parseGovernanceTypedData,
  toSignable,
} from "@/common/typed-data";
import { concat, encodeAbiParameters, getAddress, hashTypedData, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { MAINNET, SAFE_MESSAGES, UPGRADE_ID, messagesFor } from "../support/fixtures";

const councilDomain = {
  name: "SecurityCouncil",
  version: "1",
  chainId: 1,
  verifyingContract: MAINNET.securityCouncil,
} as const;

describe("governance typed data", () => {
  it("hashes ApproveUpgradeSecurityCouncil like the contract (digest Safe filed the messages under)", () => {
    const typedData = buildTypedData("ApproveUpgradeSecurityCouncil", councilDomain, {
      id: UPGRADE_ID,
    });
    const { digest } = governanceHashes(typedData);
    expect(digest).toBe("0x86db57b67855110636064406797dbbdc409d97325acf6e943d9b15f25d03e596");
    // Same as viem's reference implementation on the raw object.
    expect(digest).toBe(
      hashTypedData(toSignable(typedData) as Parameters<typeof hashTypedData>[0])
    );
  });

  it("parses every governance message Safe stores and rejects look-alikes", () => {
    const all = Object.values(SAFE_MESSAGES).flat();
    expect(all.length).toBeGreaterThan(100);
    for (const m of all) expect(parseGovernanceTypedData(m.message, 1)).not.toBeNull();

    const sample = messagesFor("ApproveUpgradeSecurityCouncil", UPGRADE_ID)[0]?.message;
    if (!sample) throw new Error("fixture missing");
    expect(parseGovernanceTypedData(sample, 11155111)).toBeNull(); // other chain
    expect(parseGovernanceTypedData({ ...sample, primaryType: "Mail" }, 1)).toBeNull();
    const renamed = {
      ...sample,
      types: {
        ...(sample.types as object),
        ApproveUpgradeSecurityCouncil: [{ name: "uid", type: "bytes32" }],
      },
    };
    expect(parseGovernanceTypedData(renamed, 1)).toBeNull(); // different field, different typehash
    expect(parseGovernanceTypedData({ ...sample, message: { id: "0x1234" } }, 1)).toBeNull();
    expect(parseGovernanceTypedData("personal message", 1)).toBeNull();
  });

  it("normalizes Safe's JSON (decimal strings, lowercase addresses) without changing the digest", () => {
    const veto = Object.values(SAFE_MESSAGES)
      .flat()
      .find((m) => m.message.primaryType === "CancelL2GovernorProposal");
    if (!veto) throw new Error("fixture missing");
    const parsed = parseGovernanceTypedData(veto.message, 1);
    expect(parsed?.message.l2GovernorAddress).toBe(
      getAddress(veto.message.message.l2GovernorAddress as string)
    );
    const signable = toSignable(parsed as NonNullable<typeof parsed>);
    expect(typeof signable.message.l2GasLimit).toBe("bigint");
  });
});

describe("Safe message hashes", () => {
  it("reproduces the hash Safe filed each member's message under", () => {
    const typedData = buildTypedData("ApproveUpgradeSecurityCouncil", councilDomain, {
      id: UPGRADE_ID,
    });
    const { digest } = governanceHashes(typedData);
    const filed = messagesFor("ApproveUpgradeSecurityCouncil", UPGRADE_ID);
    expect(filed).toHaveLength(7);
    for (const m of filed) {
      expect(safeMessageHashes(1, getAddress(m.safe), digest).safeMessageHash).toBe(m.messageHash);
    }
  });

  it("splits into the domain and message hashes a hardware wallet shows", () => {
    const safe = "0xc3Abc9f9AA75Be8341E831482cdA0125a7B1A23e"; // Matter Labs' member Safe
    const digest = "0x86db57b67855110636064406797dbbdc409d97325acf6e943d9b15f25d03e596";
    const hashes = safeMessageHashes(1, safe, digest);
    // Built independently, the way Safe's contracts encode them (v1.3.0+).
    const domainHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [keccak256(toHex("EIP712Domain(uint256 chainId,address verifyingContract)")), 1n, safe]
      )
    );
    const messageHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [keccak256(toHex("SafeMessage(bytes message)")), keccak256(digest)]
      )
    );
    expect(hashes.domainHash).toBe(domainHash);
    expect(hashes.messageHash).toBe(messageHash);
    expect(hashes.safeMessageHash).toBe(keccak256(concat(["0x1901", domainHash, messageHash])));
    // …and it is the hash Safe filed this member's message under.
    const filed = messagesFor("ApproveUpgradeSecurityCouncil", UPGRADE_ID).find(
      (m) => getAddress(m.safe) === safe
    );
    expect(hashes.safeMessageHash).toBe(filed?.messageHash);
  });

  it("recovers the owners whose signatures make up a prepared signature", async () => {
    for (const m of messagesFor("ApproveUpgradeSecurityCouncil", UPGRADE_ID)) {
      const owners = await recoverSafeOwners(m.messageHash, m.preparedSignature as `0x${string}`);
      expect(owners.map((o) => o.owner).sort()).toEqual(
        m.confirmations.map((c) => getAddress(c.owner)).sort()
      );
    }
  });

  it("reads contract (v=0) and approved-hash (v=1) parts without recovering", async () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const r = `000000000000000000000000${owner.slice(2)}`;
    const approved = await recoverSafeOwners(`0x${"ab".repeat(32)}`, `0x${r}${"00".repeat(32)}01`);
    expect(approved).toEqual([{ owner: getAddress(owner), kind: "approved-hash" }]);
    const offset = (65).toString(16).padStart(64, "0");
    const contract = await recoverSafeOwners(
      `0x${"ab".repeat(32)}`,
      `0x${r}${offset}00${"00".repeat(32)}`
    );
    expect(contract).toEqual([{ owner: getAddress(owner), kind: "contract" }]);
  });
});
