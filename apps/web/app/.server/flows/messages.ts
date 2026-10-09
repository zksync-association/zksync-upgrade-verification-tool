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
import { SafeApiError, type SafeMessage } from "../safe-api";
import {
  SAFE_LISTING_MAX_AGE_MS,
  type SafeSnapshot,
  heldSafeListing,
  listSafeMessages,
} from "../safe/store";

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

export type Collected = {
  groups: Grouped[];
  errors: string[];
  anomalies: number;
  /** When the oldest listing read was fetched (ISO time), or null when none was. */
  safeFetchedAt?: string | null;
  /** Some listing was older than 60 s (only collectHeldMessages', for a page's first answer). */
  stale?: boolean;
};

/** A Safe's listing as collected: its messages, and when Safe's answer arrived (when known). */
type Listing = { messages: SafeMessage[]; fetchedAt?: number };

/** A message read as one of ours: its typed data and digest, and whether Safe filed it right. */
type Reading = { typedData: GovernanceTypedData; digest: Hex; filed: boolean } | null;

// What each message read as, per Safe and chain, keyed by the message object the Safe store
// holds: the store keeps the objects of messages that did not change when it reads a listing
// again, so each message's typed data is parsed and hashed once, not on every page (on a page that
// work comes before its first bytes are sent: about 0.1 s for the 17 member Safes' listings).
// Dropped objects are collected with their readings. warmMessageReadings does it for the listings
// held at the start, off the request path.
const readings = new WeakMap<SafeMessage, Map<string, Reading>>();

const readingKey = (safe: Address, chainId: number) => `${chainId}:${safe.toLowerCase()}`;

function readMessage(message: SafeMessage, safe: Address, chainId: number): Reading {
  const key = readingKey(safe, chainId);
  let bySafe = readings.get(message);
  const known = bySafe?.get(key);
  if (known !== undefined) return known;
  const typedData = parseGovernanceTypedData(message.message, chainId);
  let reading: Reading = null;
  if (typedData) {
    const { digest } = governanceHashes(typedData);
    const expected = safeMessageHashes(chainId, safe, digest).safeMessageHash;
    reading = {
      typedData,
      digest,
      filed: expected.toLowerCase() === message.messageHash.toLowerCase(),
    };
  }
  if (!bySafe) {
    bySafe = new Map();
    readings.set(message, bySafe);
  }
  bySafe.set(key, reading);
  return reading;
}

/**
 * Reads (parses and hashes) the messages of the listings held for these Safes, of any age, as
 * collecting them would, one Safe at a time with a turn of the event loop between: the boot
 * warm-up's, so that the first page to list them does not do it before its first bytes. Never asks
 * Safe. Returns how many messages it read (those not read before).
 */
export async function warmMessageReadings(safes: readonly Address[]): Promise<number> {
  const { chainId } = await network();
  let read = 0;
  for (const safe of safes) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const listing = heldSafeListing(safe);
    if (!listing) continue;
    const key = readingKey(safe, chainId);
    for (const message of listing.messages) {
      if (readings.get(message)?.has(key)) continue;
      readMessage(message, safe, chainId);
      read++;
    }
  }
  return read;
}

const sameDomain = (a: Eip712Domain, b: Eip712Domain) =>
  a.name === b.name &&
  a.version === b.version &&
  a.chainId === b.chainId &&
  isAddressEqual(a.verifyingContract, b.verifyingContract);

/** The governance messages in members' Safe listings (at most 60 s old, read when older). */
export function collectMessages(
  safes: Address[],
  actions: readonly ActionName[],
  domain: Eip712Domain
): Promise<Collected> {
  return collectFrom(safes, actions, domain, listSafeMessages);
}

/**
 * collectMessages from the listings held now, whatever their age, without asking Safe: a page's
 * first answer while the fresh listings are read (`stale` when one is older than 60 s, or was read
 * by the last run). null when a Safe has no listing held.
 */
export async function collectHeldMessages(
  safes: Address[],
  actions: readonly ActionName[],
  domain: Eip712Domain
): Promise<Collected | null> {
  const held = new Map<string, SafeSnapshot>();
  for (const safe of safes) {
    const listing = heldSafeListing(safe);
    if (!listing) return null;
    held.set(safe.toLowerCase(), listing);
  }
  const now = Date.now();
  // A listing the last run read (kept on disk) is stale whatever its age.
  const stale = [...held.values()].some(
    (listing) => listing.fromLastRun || now - listing.fetchedAt > SAFE_LISTING_MAX_AGE_MS
  );
  const collected = await collectFrom(safes, actions, domain, async (safe) => {
    const listing = held.get(safe.toLowerCase());
    if (!listing) throw new Error(`No listing held for ${safe}`);
    return listing;
  });
  return { ...collected, stale };
}

async function collectFrom(
  safes: Address[],
  actions: readonly ActionName[],
  domain: Eip712Domain,
  read: (safe: Address) => Promise<Listing>
): Promise<Collected> {
  const { chainId } = await network();
  const errors: string[] = [];
  let anomalies = 0;
  const found: GovernanceMessage[] = [];
  let oldest: number | null = null;

  await Promise.all(
    safes.map(async (safe) => {
      try {
        const { messages, fetchedAt } = await read(safe);
        if (typeof fetchedAt === "number" && (oldest === null || fetchedAt < oldest))
          oldest = fetchedAt;
        for (const message of messages) {
          const reading = readMessage(message, safe, chainId);
          if (
            !reading ||
            !actions.includes(reading.typedData.primaryType) ||
            !sameDomain(reading.typedData.domain, domain)
          ) {
            continue;
          }
          const { typedData, digest } = reading;
          if (!reading.filed) {
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

  const fetchedAt: number | null = oldest;
  return {
    groups: [...byDigest.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)),
    errors: [...new Set(errors)],
    anomalies,
    safeFetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
    stale: false,
  };
}
