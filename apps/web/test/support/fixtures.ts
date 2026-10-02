import { readFileSync } from "node:fs";
import type { Hex } from "viem";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const messages = load("safe-messages.mainnet.json");
const transactions = load("transactions.mainnet.json");

// Real mainnet data recorded by test/support/record-fixtures.ts (2026-10-01).

export type FixtureMessage = {
  created: string;
  modified: string;
  safe: string;
  messageHash: Hex;
  message: {
    primaryType: string;
    domain: Record<string, unknown>;
    message: Record<string, string>;
  } & Record<string, unknown>;
  proposedBy: string;
  confirmations: { owner: string; signature: Hex; signatureType: string }[];
  preparedSignature: Hex | null;
};

export const SAFE_MESSAGES = messages as unknown as Record<string, FixtureMessage[]>;
export const TRANSACTIONS = transactions as Record<
  string,
  { to: string; input: Hex; blockNumber: string }
>;

export const MAINNET = {
  upgradeHandler: "0xE30Dca3047B37dc7d88849dE4A4Dc07937ad5Ab3",
  securityCouncil: "0x59195219d1176E42f8e607e9AC114926D47f9035",
  guardians: "0x600dA620Ab29F41ABC6596a15981e14cE58c86b8",
  emergencyUpgradeBoard: "0xF73a7dCfa68E52030ec39E41a23DCA51F3aAa111",
  zkFoundation: "0xbC1653bd3829dfEc575AfC3816D4899cd103B51c",
} as const;

export const UPGRADE_ID: Hex = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa";
export const APPROVAL_TX: Hex =
  "0x1defa4f7f06a4c8a5066ea56f2a27b00a2beeb016cec336692e39460c3f55e11";
export const EMERGENCY_TX: Hex =
  "0xb5b9c800a5df2db38d237f6ce4ee144b2079fdfcc1ea717566f80094e5a439dd";
export const EMERGENCY_ID: Hex =
  "0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e";

/** Every recorded message of `primaryType` whose message.id is `id`. */
export function messagesFor(primaryType: string, id: Hex) {
  return Object.values(SAFE_MESSAGES)
    .flat()
    .filter(
      (m) =>
        m.message.primaryType === primaryType &&
        m.message.message.id?.toLowerCase() === id.toLowerCase()
    );
}
