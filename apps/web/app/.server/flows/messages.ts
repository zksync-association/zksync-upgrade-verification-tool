import { safeMessageHashes } from "@/common/safe";
import {
  type ActionName,
  type Eip712Domain,
  type GovernanceTypedData,
  governanceHashes,
  parseGovernanceTypedData,
} from "@/common/typed-data";
import { type Address, type Hex, isAddressEqual } from "viem";
import { network } from "../rpc";
import { SafeApiError } from "../safe-api";
import { listSafeMessages } from "../safe/store";

// Freeze requests, L2 vetoes and emergency upgrades exist only as messages members signed in their
// Safes. This turns those listings into proposals, keeping a message only when its typed data is
// one of ours, its domain is the live contract's, and the hash Safe filed it under is the one this
// app computes for that Safe. Signature validity is checked later, per proposal, on-chain.

export type GovernanceMessage = {
  safe: Address;
  typedData: GovernanceTypedData;
  digest: Hex;
  created: string;
  confirmations: number;
};

export type Grouped = {
  digest: Hex;
  typedData: GovernanceTypedData;
  // As reported by Safe; verified on the detail page.
  reportedSigners: Address[];
  firstSeen: string;
  lastSeen: string;
};

export type Collected = { groups: Grouped[]; errors: string[]; anomalies: number };

const sameDomain = (a: Eip712Domain, b: Eip712Domain) =>
  a.name === b.name &&
  a.version === b.version &&
  a.chainId === b.chainId &&
  isAddressEqual(a.verifyingContract, b.verifyingContract);

export async function collectMessages(
  safes: Address[],
  actions: readonly ActionName[],
  domain: Eip712Domain
): Promise<Collected> {
  const { chainId } = await network();
  const errors: string[] = [];
  let anomalies = 0;
  const found: GovernanceMessage[] = [];

  await Promise.all(
    safes.map(async (safe) => {
      try {
        const { messages } = await listSafeMessages(safe);
        for (const message of messages) {
          const typedData = parseGovernanceTypedData(message.message, chainId);
          if (
            !typedData ||
            !actions.includes(typedData.primaryType) ||
            !sameDomain(typedData.domain, domain)
          ) {
            continue;
          }
          const { digest } = governanceHashes(typedData);
          const expected = safeMessageHashes(chainId, safe, digest).safeMessageHash;
          if (expected.toLowerCase() !== message.messageHash.toLowerCase()) {
            anomalies++;
            continue;
          }
          found.push({
            safe,
            typedData,
            digest,
            created: message.created,
            confirmations: message.confirmations.length,
          });
        }
      } catch (error) {
        errors.push(
          error instanceof SafeApiError ? error.message : `Safe ${safe}: ${String(error)}`
        );
      }
    })
  );

  const byDigest = new Map<string, Grouped>();
  for (const m of found) {
    const key = m.digest.toLowerCase();
    const group = byDigest.get(key);
    if (!group) {
      byDigest.set(key, {
        digest: m.digest,
        typedData: m.typedData,
        reportedSigners: [m.safe],
        firstSeen: m.created,
        lastSeen: m.created,
      });
      continue;
    }
    if (!group.reportedSigners.some((s) => isAddressEqual(s, m.safe)))
      group.reportedSigners.push(m.safe);
    if (m.created < group.firstSeen) group.firstSeen = m.created;
    if (m.created > group.lastSeen) group.lastSeen = m.created;
  }

  return {
    groups: [...byDigest.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)),
    errors: [...new Set(errors)],
    anomalies,
  };
}
