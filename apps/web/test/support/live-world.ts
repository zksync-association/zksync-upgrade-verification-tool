// A mainnet-like world for the per-block tests: the fake L1 node with the handler's history, an
// executed upgrade and emergency upgrade whose signature sets a page shows, members' ECDSA
// signatures in a fake Safe Transaction Service, and the live engine run block by block.

import { puhIndex } from "@/.server/chain/puh-index";
import { network, pollHead, rpcGeneration } from "@/.server/rpc";
import type { SafeMessage } from "@/.server/safe-api";
import type { SignatureSetParams } from "@/.server/signatures";
import { SyncEngine, type SyncEngineOptions, liveSteps } from "@/.server/sync/engine";
import { presence } from "@/.server/sync/presence";
import { safeMessageHashes } from "@/common/safe";
import { type ActionName, buildTypedData, governanceHashes } from "@/common/typed-data";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { type Address, type Hex, numberToHex, pad, zeroAddress } from "viem";
import { vi } from "vitest";
import { blockHash, puhHistory } from "./fake-chain";
import {
  type FakeL1Options,
  G_MEMBERS,
  L1,
  SC_MEMBERS,
  type UpgradeOnChain,
  fakeL1,
} from "./fake-l1";

export const NOW = 1_800_000_000_000;
export const HEAD = 26_129_107n;
export const HEAD_TIME = BigInt(Math.floor(NOW / 1000)) - 1n;
export const FINAL_LAG = 80n;
export const SLOT_MS = 12_000;

/** An ECDSA-only Safe signature: one 65-byte segment, v = 27 (or `v`). */
export const ecdsa = (n: number, v = 27): Hex =>
  `0x${pad(numberToHex(n), { size: 32 }).slice(2)}${"22".repeat(32)}${v.toString(16).padStart(2, "0")}`;

/** Runs the fake clock in small steps until `done` (each step lets batching windows close). */
export async function until(done: () => boolean, maxMs = 5_000) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > maxMs) throw new Error("timed out waiting");
    await vi.advanceTimersByTimeAsync(10);
  }
}

/** Runs the fake clock until `promise` settles, and returns its value (or throws its error). */
export async function settle<T>(promise: Promise<T>, maxMs = 10_000): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  void tracked.catch(() => {});
  await until(() => done, maxMs);
  return tracked;
}

export function liveEngine(options: Partial<SyncEngineOptions> = {}) {
  return new SyncEngine({
    mode: "window",
    inUse: () => presence().inUse(),
    generation: rpcGeneration(),
    currentGeneration: rpcGeneration,
    network,
    pollHead,
    steps: liveSteps(),
    ...options,
  });
}

/** The handler's index backfilled, as the boot warm-up leaves it. */
export async function backfilled() {
  const index = puhIndex();
  void index.startBackfill();
  await until(() => index.status().state === "ready");
}

const SC_DOMAIN = {
  name: "SecurityCouncil",
  version: "1",
  chainId: 1,
  verifyingContract: L1.securityCouncil,
};
const G_DOMAIN = { name: "Guardians", version: "1", chainId: 1, verifyingContract: L1.guardians };
export const EUB_DOMAIN = {
  name: "EmergencyUpgradeBoard",
  version: "1",
  chainId: 1,
  verifyingContract: L1.emergencyUpgradeBoard,
};

type SetSpec = {
  action: ActionName;
  group: SignatureSetParams["signerGroup"];
  domain: typeof SC_DOMAIN;
  id: Hex;
  members: readonly Address[];
  threshold: number;
  check: SignatureSetParams["check"];
  /** The members who signed in Safe (each with its own ECDSA signature). */
  signed: readonly Address[];
};

export type LiveWorld = ReturnType<typeof liveWorld>;

/**
 * The world: `upgradeId`/`emergencyId` are executed, `sets` the six signature sets their pages
 * show (all done), and `nextBlock()` makes a new head 12 s after the last, 'finalized' with it.
 */
export function liveWorld(options: Omit<FakeL1Options, "head" | "logs" | "upgrades"> = {}) {
  const head = { number: HEAD, timestamp: HEAD_TIME };
  const history = puhHistory(L1.deployBlock, HEAD - FINAL_LAG - 1_000n);
  const upgrades = new Map<string, UpgradeOnChain>();
  for (const upgrade of history.upgrades)
    upgrades.set(upgrade.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [1_700_000_000, 1_700_000_100, true, false, true],
    });
  for (const emergency of history.emergencies)
    upgrades.set(emergency.id.toLowerCase(), {
      state: UPGRADE_STATES.Done,
      status: [0, 0, false, false, true],
    });
  const upgradeId = (history.upgrades[0] as { id: Hex }).id;
  const emergencyId = (history.emergencies[0] as { id: Hex }).id;
  const signatures = options.signatures ?? new Set<string>();
  const fake = fakeL1({
    ...options,
    head,
    finalized: HEAD - FINAL_LAG,
    logs: history.logs,
    upgrades,
    signatures,
  });

  const specs: SetSpec[] = [
    {
      action: "ApproveUpgradeSecurityCouncil",
      group: "securityCouncil",
      domain: SC_DOMAIN,
      id: upgradeId,
      members: SC_MEMBERS,
      threshold: 2,
      check: { kind: "multisig", contract: L1.securityCouncil },
      signed: SC_MEMBERS.slice(0, 2),
    },
    {
      action: "ApproveUpgradeGuardians",
      group: "guardians",
      domain: G_DOMAIN,
      id: upgradeId,
      members: G_MEMBERS,
      threshold: 2,
      check: { kind: "multisig", contract: L1.guardians },
      signed: G_MEMBERS.slice(0, 2),
    },
    {
      action: "ExtendLegalVetoPeriod",
      group: "guardians",
      domain: G_DOMAIN,
      id: upgradeId,
      members: G_MEMBERS,
      threshold: 1,
      check: { kind: "multisig", contract: L1.guardians },
      signed: [],
    },
    {
      action: "ExecuteEmergencyUpgradeSecurityCouncil",
      group: "securityCouncil",
      domain: EUB_DOMAIN,
      id: emergencyId,
      members: SC_MEMBERS,
      threshold: 2,
      check: { kind: "multisig-1271", contract: L1.securityCouncil },
      signed: SC_MEMBERS.slice(0, 2),
    },
    {
      action: "ExecuteEmergencyUpgradeGuardians",
      group: "guardians",
      domain: EUB_DOMAIN,
      id: emergencyId,
      members: G_MEMBERS,
      threshold: 2,
      check: { kind: "multisig-1271", contract: L1.guardians },
      signed: G_MEMBERS.slice(1, 3),
    },
    {
      action: "ExecuteEmergencyUpgradeZKFoundation",
      group: "zkFoundation",
      domain: EUB_DOMAIN,
      id: emergencyId,
      members: [L1.zkFoundation],
      threshold: 1,
      check: { kind: "safe-1271", contract: L1.zkFoundation },
      signed: [L1.zkFoundation],
    },
  ];

  // Safe's listings: each member's messages, signed with its own ECDSA signature.
  const listings = new Map<string, SafeMessage[]>();
  let n = 1;
  const sets: SignatureSetParams[] = specs.map((spec) => {
    const typedData = buildTypedData(spec.action, spec.domain, { id: spec.id });
    const { digest } = governanceHashes(typedData);
    for (const member of spec.signed) {
      const signature = ecdsa(n++);
      const at = new Date(NOW - 3_600_000).toISOString();
      const confirmation = { owner: zeroAddress, signature, signatureType: "EOA" };
      const list = listings.get(member.toLowerCase()) ?? [];
      list.push({
        created: at,
        modified: at,
        safe: member,
        messageHash: safeMessageHashes(1, member, digest).safeMessageHash,
        message: {},
        confirmations: [confirmation, confirmation],
        preparedSignature: signature,
      });
      listings.set(member.toLowerCase(), list);
      signatures.add(`${member}:${signature}`.toLowerCase());
    }
    return {
      action: spec.action,
      signerGroup: spec.group,
      typedData,
      members: [...spec.members],
      threshold: spec.threshold,
      check: spec.check,
      open: false,
    };
  });

  const safeRequests: string[] = [];
  /** Member Safes (lower case) whose every request to Safe answers HTTP 500. */
  const safeFailing = new Set<string>();
  /** While `exhausted`, Safe answers every request 429: this IP's monthly quota is used up. */
  const safeQuota = { exhausted: false };
  /**
   * `member` signs the typed data in its Safe with `signature` (accepted by the contracts), now.
   * With `listed`, the message carries its typed data, so lists built from Safe messages find it.
   */
  const signInSafe = (
    member: Address,
    typedData: SignatureSetParams["typedData"],
    signature: Hex,
    { listed = false }: { listed?: boolean } = {}
  ) => {
    const { digest } = governanceHashes(typedData);
    const at = new Date(Date.now()).toISOString();
    const confirmation = { owner: zeroAddress, signature, signatureType: "EOA" };
    const list = listings.get(member.toLowerCase()) ?? [];
    list.push({
      created: at,
      modified: at,
      safe: member,
      messageHash: safeMessageHashes(1, member, digest).safeMessageHash,
      message: listed ? JSON.parse(JSON.stringify(typedData)) : {},
      confirmations: [confirmation, confirmation],
      preparedSignature: signature,
    });
    listings.set(member.toLowerCase(), list);
    signatures.add(`${member}:${signature}`.toLowerCase());
  };
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.safe.global/")) {
      safeRequests.push(url);
      if (safeQuota.exhausted)
        return new Response("Monthly quota exceeded", {
          status: 429,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "86400" },
        });
      const safe = /\/safes\/(0x[0-9a-fA-F]{40})\/messages\//.exec(url)?.[1]?.toLowerCase();
      if (safe && safeFailing.has(safe)) return new Response("Server error", { status: 500 });
      const all = [...((safe && listings.get(safe)) || [])];
      // Ordered and paged as Safe does (newest first by creation, or by modification).
      const query = new URL(url).searchParams;
      const by = query.get("ordering") === "-modified" ? "modified" : "created";
      all.sort((a, b) => (a[by] < b[by] ? 1 : a[by] > b[by] ? -1 : 0));
      const offset = Number(query.get("offset") ?? 0);
      const results = all.slice(offset, offset + Number(query.get("limit") ?? 100));
      return Response.json({ count: all.length, results });
    }
    return fake.fetch(input as string, init);
  });

  return {
    fake,
    history,
    upgrades,
    signatures,
    upgradeId,
    emergencyId,
    sets,
    safeRequests,
    safeFailing,
    safeQuota,
    signInSafe,
    /** A new head a second before now (every 12 s of fake time), 'finalized' FINAL_LAG behind. */
    nextBlock() {
      const current = fake.chain.options.head as { number: bigint };
      const number = current.number + 1n;
      fake.chain.options.head = {
        number,
        hash: blockHash(number),
        timestamp: BigInt(Math.floor(Date.now() / 1000)) - 1n,
      };
      fake.chain.options.finalized = number - FINAL_LAG;
      return number;
    },
    head: () => (fake.chain.options.head as { number: bigint }).number,
  };
}
