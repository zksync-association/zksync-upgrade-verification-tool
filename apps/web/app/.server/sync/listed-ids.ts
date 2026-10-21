import type { Hex } from "viem";
import { linkStore } from "../cache";

// Upgrade ids a list shows that the handler's log index does not know: the emergency upgrades
// members signed in their Safes that are not executed yet (flows/emergency.ts pendingFrom). While
// such a list is on screen, the per-block snapshot reads their state at each head in the head's
// aggregate3 beside the others (sync/snapshot.ts), so assembling the list at that head reads
// nothing more. Only which ids to read is kept here, never a value: the last list's ids (at most
// LIMIT), replaced whenever the list is assembled.

const LIMIT = 64;
let emergency = new Map<string, Hex>();

/** The ids the emergency list was last assembled from (members' Safe messages). */
export function noteListedEmergencyIds(ids: Iterable<Hex>) {
  const next = new Map<string, Hex>();
  for (const id of ids) {
    if (next.size >= LIMIT) break;
    next.set(id.toLowerCase(), id);
  }
  emergency = next;
}

/** The ids the lists among `keys` (the keys on screen) show beyond the index's, by lower case. */
export function listedIds(keys: ReadonlySet<string>): Map<string, Hex> {
  for (const key of keys) if (key.startsWith("list:emergency")) return new Map(emergency);
  return new Map();
}

/** Forgets them (tests). */
export function resetListedIds() {
  emergency = new Map();
}

// A settings change (maybe another chain) drops them; the next list names its own.
linkStore("listed-ids:", (prefix) => {
  if (prefix === null) resetListedIds();
});
