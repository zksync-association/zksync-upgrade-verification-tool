import type { Address, Hex } from "viem";
import { peek } from "../cache";
import { heldEmergencyList } from "../flows/emergency";
import { heldFreezeList } from "../flows/freeze";
import {
  type L2ProposalView,
  activeL2ProposalsAnswer,
  getL2ProposalAnswer,
  notStartedUpgrades,
} from "../flows/l2";
import { heldVetoList } from "../flows/l2-veto";
import { listStandardUpgrades } from "../flows/standard";
import { pageGovernance } from "../page-governance";
import { ERA_PAGE_MAX_AGE_MS } from "../chain/l2-index";
import { type BlockRef, l2, lastL2Head, network } from "../rpc";
import { appStatus } from "../status";
import { type UpgradeStatusRead, upgradeStatusKey } from "../upgrade-status";
import {
  emergencyListContent,
  freezeListContent,
  idContent,
  l2Content,
  startableContent,
  statusContent,
  upgradeListContent,
  vetoListContent,
} from "./content";
import { ReceiptLost, receiptContent, receiptView, resetReceipts } from "./receipt";
import { type WatchItem, isL2Key, startableDaysOf } from "./presence";
import { currentRev, noteContent } from "./revs";

// The sync engine's passes over what is on screen: at each served head, from memory, and for
// ZKsync Era on its timer.

const ID = /^(upgrade|emergency):(0x[0-9a-f]{64})$/;
const L2 = /^l2:(0x[0-9a-f]{40}):(\d+)$/;
const TX = /^tx:(0x[0-9a-f]{64})$/;

// Notes what memory holds at the served head for each key on screen; a key whose content is not in
// memory keeps its revision (nothing is noted from an unknown value). Transaction receipts are read
// here, once per head while their page is on screen, until found. Never rejects.
export async function noteOnScreenContent(
  head: BlockRef,
  keys: Iterable<string>,
  current: () => boolean = () => true
): Promise<{ noted: number; skipped: number }> {
  const tally = { noted: 0, skipped: 0 };
  const at = { head: head.number };
  const net = await network();
  await Promise.all(
    [...keys].map(async (key) => {
      try {
        const noted = await noteKey(key, head, at, net.chainId, current);
        if (noted) tally.noted++;
        else tally.skipped++;
      } catch {
        tally.skipped++;
      }
    })
  );
  return tally;
}

async function noteKey(
  key: string,
  head: BlockRef,
  at: { head: bigint },
  chainId: number,
  current: () => boolean
): Promise<boolean> {
  if (key === "status") {
    const status = await appStatus({ freshness: "page" });
    if (!status.ok || !current()) return false;
    noteContent(key, { head: BigInt(status.governance.latestBlock.number) }, statusContent(status));
    return true;
  }
  const id = ID.exec(key);
  if (id) {
    const read = peek<UpgradeStatusRead>(upgradeStatusKey(chainId, id[2] as Hex, head));
    const value = read ? await read.catch(() => null) : null;
    if (!value || !current()) return false;
    noteContent(key, at, idContent(value));
    return true;
  }
  const upgrades = /^list:upgrades(?::(90|all))?$/.exec(key);
  if (upgrades) {
    const list = await listStandardUpgrades({
      allHistory: upgrades[1] === "all",
      days: upgrades[1] === "90" ? 90n : undefined,
      freshness: "page",
    });
    if (list.fromLastRun || !current()) return false;
    noteContent(key, at, upgradeListContent(list));
    return true;
  }
  if (key === "list:emergency" || key === "list:emergency:all") {
    const list = await heldEmergencyList({ allHistory: key.endsWith(":all") });
    if (!list || !current()) return false;
    noteContent(
      key,
      readAt(at, list.governance),
      emergencyListContent(list.pending, list.executed)
    );
    return true;
  }
  if (key === "list:freeze") {
    const list = await heldFreezeList();
    if (!list || !current()) return false;
    noteContent(key, readAt(at, list.governance), freezeListContent(list));
    return true;
  }
  if (key === "list:vetoes") return noteVetoList(at, current);
  const tx = TX.exec(key);
  if (tx) {
    // A failed read notes nothing (never "not mined" from a failure); a receipt found before but
    // not now is noted as unread: the page reloads and says so (never the old one as current).
    const receipt = await receiptView(tx[1] as Hex).then(
      (receipt) => ({ receipt, unread: false }),
      (error: unknown) => {
        if (error instanceof ReceiptLost) return { receipt: null, unread: true };
        throw error;
      }
    );
    if (!current()) return false;
    noteContent(key, at, receiptContent(receipt));
    return true;
  }
  return false;
}

// A list built on governance is noted at the block its governance was read at when that is older
// than the head: never at a head it was not read at.
export function readAt(at: { head: bigint }, gov: { latestBlock: { number: string } }) {
  const read = BigInt(gov.latestBlock.number);
  return { head: read < at.head ? read : at.head };
}

async function noteVetoList(at: { head: bigint }, current: () => boolean): Promise<boolean> {
  // ZKsync Era as the Era timer last read it (sync/era.ts): an L1 head never reads Era itself.
  const era = lastL2Head();
  if ((await l2()) && (!era || Date.now() - era.answeredAt > ERA_PAGE_MAX_AGE_MS)) return false;
  const list = await heldVetoList();
  // An Era read that failed is no content: the vetoable part says nothing then.
  if (!list || list.vetoable.l2Error !== null || !current()) return false;
  const item = noteContent("list:vetoes", at, vetoListContent(list.signed, list.vetoable));
  noteEraHead(item, list.vetoable.eraHead ?? null);
  return true;
}

// For each Era key, the Era head its content was last assembled at: a page names only a head the
// content it shows was read at, never a newer one whose read failed.
type EraNote = { rev: string; era: { number: string; readAt: string } };
const eraNotes = new Map<string, EraNote>();
const ERA_NOTES_LIMIT = 64;

function noteEraHead(item: WatchItem, era: { number: string; readAt: string } | null) {
  if (!era || item.rev === null || item.rev === "0") return;
  const known = eraNotes.get(item.key);
  // Content noted again at an older Era head (computations can end out of order) keeps the newer.
  if (known && known.rev === item.rev && BigInt(known.era.number) >= BigInt(era.number)) return;
  eraNotes.delete(item.key);
  eraNotes.set(item.key, { rev: item.rev, era });
  while (eraNotes.size > ERA_NOTES_LIMIT) eraNotes.delete(eraNotes.keys().next().value as string);
}

export function eraHeadsFor(
  items: readonly WatchItem[]
): Record<string, { number: string; readAt: string }> {
  const heads: Record<string, { number: string; readAt: string }> = {};
  for (const { key, rev } of items) {
    if (!isL2Key(key) || rev === null || rev !== currentRev(key)) continue;
    const note = eraNotes.get(key);
    if (note && note.rev === rev) heads[key] = { ...note.era };
  }
  return heads;
}

// The Era timer's pass over the Era keys on screen; returns the proposals they show, for the
// boundary timers. Never rejects.
export async function noteEraContent(
  keys: Iterable<string>,
  current: () => boolean = () => true
): Promise<{ proposals: L2ProposalView[]; noted: number }> {
  const proposals: L2ProposalView[] = [];
  let noted = 0;
  const gov = () => pageGovernance();
  await Promise.all(
    [...keys].filter(isL2Key).map(async (key) => {
      try {
        if (key === "list:vetoes") {
          // Era first (the states pages show), whatever the Safe copies held; then the whole list.
          const vetoable = await activeL2ProposalsAnswer({ gov, page: true });
          proposals.push(...vetoable.proposals);
          const head = BigInt((await pageGovernance()).latestBlock.number);
          if (await noteVetoList({ head }, current)) noted++;
          return;
        }
        const days = startableDaysOf(key);
        if (days !== null) {
          const items = await notStartedUpgrades({ page: true, days });
          if (!current()) return;
          const head = BigInt((await pageGovernance()).latestBlock.number);
          noteContent(key, { head }, startableContent(items));
          noted++;
          return;
        }
        const l2 = L2.exec(key);
        if (!l2) return;
        const { proposal, eraHead } = await getL2ProposalAnswer(
          l2[1] as Address,
          BigInt(l2[2] as string),
          { gov, page: true }
        );
        if (!current()) return;
        if (proposal) proposals.push(proposal);
        const head = BigInt((await pageGovernance()).latestBlock.number);
        noteEraHead(noteContent(key, { head }, l2Content(proposal, null)), eraHead);
        noted++;
      } catch {
        // Not read now: the key keeps its revision, and the next pass tries again.
      }
    })
  );
  return { proposals, noted };
}

export function resetContent() {
  resetReceipts();
  eraNotes.clear();
}
