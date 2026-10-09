import type { Governance } from "@/.server/governance";
import type { SafeMessage } from "@/.server/safe-api";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMERGENCY_ID, MAINNET, SAFE_MESSAGES } from "../support/fixtures";

// Turning Safe listings into proposals (real recorded messages), and the on-chain rules for when
// a freeze request or a veto can still be executed.

const listings = vi.hoisted(() => ({ tamper: false }));

vi.mock("@/.server/rpc", () => ({ network: async () => ({ chainId: 1 }) }));
vi.mock("@/.server/safe-api", async () => {
  const { SAFE_MESSAGES } = await import("../support/fixtures");
  class SafeApiError extends Error {}
  return {
    SafeApiError,
    listSafeMessages: async (safe: string) => {
      const messages = (SAFE_MESSAGES[safe] ?? []) as unknown as SafeMessage[];
      return {
        complete: true,
        messages: listings.tamper
          ? messages.map((m) => ({ ...m, messageHash: `0x${"00".repeat(32)}` as const }))
          : messages,
      };
    },
  };
});

const { collectMessages } = await import("@/.server/flows/messages");
const { freezeState } = await import("@/.server/flows/freeze");
const { vetoState } = await import("@/.server/flows/l2-veto");

const ALL_SAFES = Object.keys(SAFE_MESSAGES).map((s) => getAddress(s));
const board = {
  name: "EmergencyUpgradeBoard",
  version: "1",
  chainId: 1,
  verifyingContract: MAINNET.emergencyUpgradeBoard,
};
const EMERGENCY = [
  "ExecuteEmergencyUpgradeSecurityCouncil",
  "ExecuteEmergencyUpgradeGuardians",
  "ExecuteEmergencyUpgradeZKFoundation",
] as const;

beforeEach(() => {
  listings.tamper = false;
});

describe("collectMessages", () => {
  it("groups members' Safe messages by what they sign", async () => {
    const { groups, errors, anomalies } = await collectMessages(ALL_SAFES, EMERGENCY, board);
    expect(errors).toEqual([]);
    expect(anomalies).toBe(0);
    const forId = groups.filter((g) => g.typedData.message.id === EMERGENCY_ID);
    const count = (type: string) =>
      forId.find((g) => g.typedData.primaryType === type)?.reportedSigners.length;
    expect(count("ExecuteEmergencyUpgradeSecurityCouncil")).toBe(7);
    expect(count("ExecuteEmergencyUpgradeGuardians")).toBe(5);
    expect(count("ExecuteEmergencyUpgradeZKFoundation")).toBe(1);
  });

  it("ignores messages for another contract's domain", async () => {
    const otherBoard = { ...board, verifyingContract: MAINNET.securityCouncil };
    expect((await collectMessages(ALL_SAFES, EMERGENCY, otherBoard)).groups).toEqual([]);
  });

  it("drops (and counts) messages Safe filed under a hash this app does not compute", async () => {
    listings.tamper = true;
    const { groups, anomalies } = await collectMessages(ALL_SAFES, EMERGENCY, board);
    expect(groups).toEqual([]);
    expect(anomalies).toBeGreaterThan(50);
  });
});

function gov(
  overrides: { nonce?: string; now?: string; freezeStatus?: number; guardiansNonce?: string } = {}
) {
  return {
    latestBlock: { number: "1", timestamp: overrides.now ?? "1000" },
    freeze: { protocolFrozenUntil: "0", lastFreezeStatus: overrides.freezeStatus ?? 0 },
    securityCouncil: {
      nonces: {
        softFreeze: overrides.nonce ?? "0",
        hardFreeze: "0",
        unfreeze: "0",
        setSoftFreezeThreshold: "0",
      },
      thresholds: {
        approveUpgrade: 4,
        softFreeze: 3,
        softFreezeConservative: 6,
        hardFreeze: 6,
        unfreeze: 6,
      },
    },
    guardians: { nonce: overrides.guardiansNonce ?? "1" },
  } as unknown as Governance;
}

describe("freezeState", () => {
  const soft = { action: "SoftFreeze" as const, nonce: "0", validUntil: "2000" };
  it("is open for the next nonce before the deadline", () => {
    expect(freezeState(gov(), soft).status).toBe("open");
  });
  it("is done once the nonce was used, closed for a future nonce or past deadline", () => {
    expect(freezeState(gov({ nonce: "1" }), soft).status).toBe("done");
    expect(freezeState(gov(), { ...soft, nonce: "1" }).status).toBe("closed");
    expect(freezeState(gov({ now: "2000" }), soft).status).toBe("closed");
  });
  it("follows the handler's freeze rules", () => {
    expect(freezeState(gov({ freezeStatus: 1 }), soft).status).toBe("closed");
    expect(freezeState(gov(), { ...soft, action: "Unfreeze" }).status).toBe("closed");
    expect(freezeState(gov({ freezeStatus: 2 }), { ...soft, action: "Unfreeze" }).status).toBe(
      "open"
    );
    expect(freezeState(gov({ freezeStatus: 4 }), { ...soft, action: "HardFreeze" }).status).toBe(
      "closed"
    );
    expect(
      freezeState(gov(), { ...soft, action: "SetSoftFreezeThreshold", threshold: "7" }).status
    ).toBe("closed");
  });
});

describe("vetoState", () => {
  const veto = {
    l2ProposalId: "1",
    l2GovernorAddress: MAINNET.guardians,
    l2GasLimit: "1",
    l2GasPerPubdataByteLimit: "1",
    refundRecipient: MAINNET.guardians,
    txMintValue: "0",
    nonce: "1",
  };
  it("is open only for the Guardians' next nonce while the L2 proposal can be cancelled", () => {
    expect(vetoState(gov(), veto, null).status).toBe("open");
    expect(vetoState(gov({ guardiansNonce: "2" }), veto, null).status).toBe("done");
    expect(vetoState(gov({ guardiansNonce: "0" }), veto, null).status).toBe("closed");
    const executed = { state: "Executed" } as Parameters<typeof vetoState>[2];
    expect(vetoState(gov(), veto, executed).status).toBe("closed");
  });

  it("stays open when the L2 proposal's state is unknown: only a known final state closes it", () => {
    const unknown = { state: null } as Parameters<typeof vetoState>[2];
    expect(vetoState(gov(), veto, unknown).status).toBe("open");
    const active = { state: "Active" } as Parameters<typeof vetoState>[2];
    expect(vetoState(gov(), veto, active).status).toBe("open");
  });
});
