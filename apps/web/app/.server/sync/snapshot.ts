import type { Hex } from "viem";
import { type AggregateStatus, aggregateStatus } from "../chain/aggregate";
import { puhIndex } from "../chain/puh-index";
import {
  type GovernanceAtHead,
  governanceAtHead,
  governanceReadKind,
  governanceSplitApplies,
} from "../governance";
import { network } from "../rpc";
import {
  type UpgradeStatusRead,
  isTerminalState,
  readUpgradeStatus,
  seedUpgradeStatus,
  snapshotUpgradeStatus,
} from "../upgrade-status";
import type { Tick } from "./engine";
import { presence } from "./presence";

// The sync engine's per-block snapshot (it replaces the old status step): at each served head,
// what pages show that can change from one block to the next, read AT that block, in the head's
// Multicall3 aggregate3 (chain/aggregate.ts) beside the head's other reads (the signature sets on
// screen, Safe info), and nothing carried from the block before:
// - governance's values that change (the handler's role addresses and freeze state, the
//   council's soft-freeze threshold and nonces, the Guardians' nonce: some change without any
//   log), so pages get governance at the head (governance.ts governanceAtHead) without the full
//   read; on a network without pinned code, pages read governance as JSON does instead;
// - upgradeState and upgradeStatus of every id not known to be over for good (executed, or
//   expired without approval, as read at a final block), and of the ids on screen: upgradeState
//   moves with the block's timestamp.
// The ids are those known at the head before (the handler's log index can only add ids at a new
// head) and those on screen, so they go out at once; ids the index finds in this head's tail are
// read right after. An aggregate answered for another block, or a failed sub-call, leaves that
// value unknown at the head: nothing is stored for it (requests at that head read it themselves;
// nothing older stands in for it), and sync.snapshot lists it.

/**
 * Ids seen in a state that never changes again (executed, or expired without approval): the
 * value, the head it was read at, and whether a read at a FINAL block confirmed it. Only a
 * confirmed one is carried forward without reading: a read at a head that was then reorged away
 * says nothing about the canonical chain, even once the boundary passes its height.
 */
export type SnapshotState = {
  terminal: Map<string, { value: UpgradeStatusRead; block: bigint; final: boolean }>;
  /** No read at the boundary before this head: one failed (see FINAL_READ_RETRY_BLOCKS). */
  finalReadsFrom: bigint;
  /** The ids the index knew at the last snapshot's head (lower case → id). */
  ids: Map<string, Hex>;
};

export function snapshotState(): SnapshotState {
  return { terminal: new Map(), finalReadsFrom: 0n, ids: new Map() };
}

// The boundary is often ~100 blocks deep, past the state a non-archive node keeps (Geth and
// Nethermind full nodes: 128 blocks, less while finality lags). There a read at the boundary
// fails, and the ids it would have confirmed are read at the head like the others; the
// boundary is asked again this many blocks later.
const FINAL_READ_RETRY_BLOCKS = 32n;

export type SnapshotStatus = {
  /** The head of the last snapshot. */
  block: string;
  /**
   * How pages' governance at that head was read: "split" (the values that change, in the
   * snapshot), "full-read" (a full read at the head: the first, or other contracts named),
   * "as-json" (no pinned code: governance() as JSON reads it), or null when unknown at the head.
   */
  governance: GovernanceAtHead | null;
  /** Ids whose state was read at the head, and those carried as over for good (read at a final block). */
  ids: { read: number; final: number };
  /** Values unknown at that head (nothing stored for them): `governance`, or an id. */
  unknown: string[];
  ms: number;
  /** How the provider answered the aggregates' block guard (chain/aggregate.ts). */
  guard: AggregateStatus["guard"];
};

let last: Omit<SnapshotStatus, "guard"> | null = null;

/** The last snapshot, for /api/status (sync.snapshot); null before the first. */
export function snapshotStatus(): SnapshotStatus | null {
  return last && { ...last, unknown: [...last.unknown], guard: aggregateStatus().guard };
}

/** Forgets the last snapshot (tests). */
export function resetSnapshotStatus() {
  last = null;
}

/** The upgrade and emergency upgrade ids pages on screen show. */
function idsOnScreen(): Map<string, Hex> {
  const ids = new Map<string, Hex>();
  for (const key of presence().onScreen()) {
    const match = /^(?:upgrade|emergency):(0x[0-9a-f]{64})$/.exec(key);
    if (match) ids.set(match[1] as string, match[1] as Hex);
  }
  return ids;
}

/** The engine's snapshot step for `tick`'s head (see the top of this file). */
export async function snapshotStep(tick: Tick, state: SnapshotState): Promise<void> {
  const started = Date.now();
  const net = await network();
  const head = tick.head;
  const safe = await tick.boundary();
  if (!tick.current()) return;
  const unknown: string[] = [];
  let read = 0;
  let final = 0;

  // Governance at the head for pages, where the split applies; its sub-calls join the head's
  // aggregate.
  const split = await governanceSplitApplies();
  const governanceRead = split
    ? governanceAtHead(head).then(
        (gov) => governanceReadKind(gov),
        () => null
      )
    : Promise.resolve<GovernanceAtHead | null>("as-json");

  const done = new Set<string>();
  const readIds = (ids: Map<string, Hex>) =>
    [...ids]
      .filter(([key]) => {
        if (done.has(key)) return false;
        done.add(key);
        return true;
      })
      .map(async ([key, id]) => {
        const known = state.terminal.get(key);
        if (known && !known.final && known.block <= safe && head.number >= state.finalReadsFrom) {
          // The boundary has passed the head it was read at: read it once at the boundary, which
          // never changes. Still terminal there: terminal for good. This only saves reads: when
          // the node cannot answer there, the id is read at the head below, as any other.
          const atFinal = await readUpgradeStatus(net.upgradeHandler, id, safe).catch(() => null);
          if (!tick.current()) return;
          if (atFinal === null) {
            const retryFrom = head.number + FINAL_READ_RETRY_BLOCKS;
            if (retryFrom > state.finalReadsFrom) state.finalReadsFrom = retryFrom;
          } else if (isTerminalState(atFinal.state))
            state.terminal.set(key, { ...known, value: atFinal, final: true });
          else state.terminal.delete(key);
        }
        const confirmed = state.terminal.get(key);
        if (confirmed?.final) {
          final++;
          seedUpgradeStatus(net, id, head, confirmed.value);
          return;
        }
        const value = await snapshotUpgradeStatus(net, id, head);
        if (!tick.current()) return;
        if (value === null) {
          unknown.push(id);
          return;
        }
        read++;
        if (isTerminalState(value.state) && !state.terminal.has(key))
          state.terminal.set(key, { value, block: head.number, final: false });
      });

  // The ids known before this head, and those on screen, at once.
  const first = new Map([...state.ids, ...idsOnScreen()]);
  const reads = [...readIds(first)];

  // Then the ids this head's tail adds (the index reads it for this head in its own step).
  const index = puhIndex();
  if (index.status().state === "ready") {
    const at = { waitMs: 0, head: { head, safe } };
    try {
      const [started, executed] = await Promise.all([
        index.events("UpgradeStarted", at),
        index.events("EmergencyUpgradeExecuted", at),
      ]);
      if (!tick.current()) return;
      const ids = new Map<string, Hex>();
      for (const { args } of [...started, ...executed]) ids.set(args._id.toLowerCase(), args._id);
      state.ids = ids;
      reads.push(...readIds(ids));
    } catch {
      // The tail at this head could not be read: the ids known before are read anyway, and the
      // index step reports the failure.
    }
  }
  const [governance] = await Promise.all([governanceRead, ...reads]);
  if (!tick.current()) return;
  if (governance === null) unknown.unshift("governance");
  last = {
    block: head.number.toString(),
    governance,
    ids: { read, final },
    unknown,
    ms: Date.now() - started,
  };
}
