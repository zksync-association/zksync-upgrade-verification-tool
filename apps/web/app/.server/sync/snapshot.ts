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
import { listedIds } from "./listed-ids";
import { presence } from "./presence";

// The engine's per-block snapshot: what pages show that can change between blocks (governance's
// changing values, the states of ids not over for good and of those on screen), read AT the head in
// its aggregate3. A value not answered for this block is unknown there: nothing older stands in for
// it, and sync.snapshot lists it.

// Only a terminal state confirmed by a read at a FINAL block is carried forward: a read at a head
// later reorged away says nothing about the canonical chain.
export type SnapshotState = {
  terminal: Map<string, { value: UpgradeStatusRead; block: bigint; final: boolean }>;
  finalReadsFrom: bigint;
  ids: Map<string, Hex>;
};

export function snapshotState(): SnapshotState {
  return { terminal: new Map(), finalReadsFrom: 0n, ids: new Map() };
}

// Full nodes keep about 128 blocks of state and the boundary is often about 100 deep: a failed read
// there is tried again this many blocks later (the ids are read at the head meanwhile).
const FINAL_READ_RETRY_BLOCKS = 32n;

export type SnapshotStatus = {
  block: string;
  /** "split", "full-read", "as-json", or null when unknown at the head. */
  governance: GovernanceAtHead | null;
  ids: { read: number; final: number };
  unknown: string[];
  ms: number;
  guard: AggregateStatus["guard"];
};

let last: Omit<SnapshotStatus, "guard"> | null = null;

export function snapshotStatus(): SnapshotStatus | null {
  return last && { ...last, unknown: [...last.unknown], guard: aggregateStatus().guard };
}

export function resetSnapshotStatus() {
  last = null;
}

/** Detail pages' ids, and the pending emergency upgrades a list shows (from Safe). */
function idsOnScreen(): Map<string, Hex> {
  const keys = presence().onScreen();
  const ids = listedIds(keys);
  for (const key of keys) {
    const match = /^(?:upgrade|emergency):(0x[0-9a-f]{64})$/.exec(key);
    if (match) ids.set(match[1] as string, match[1] as Hex);
  }
  return ids;
}

export async function snapshotStep(tick: Tick, state: SnapshotState): Promise<void> {
  const started = Date.now();
  const net = await network();
  const head = tick.head;
  const safe = await tick.boundary();
  if (!tick.current()) return;
  const unknown: string[] = [];
  let read = 0;
  let final = 0;

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
          // Read once at the boundary, which never changes: terminal there is terminal for good.
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

  const first = new Map([...state.ids, ...idsOnScreen()]);
  const reads = [...readIds(first)];

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
      // The ids known before are read anyway; the index step reports the failure.
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
