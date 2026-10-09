import type { PuhIndexStatus } from "@/.server/chain/puh-index";
import { puhIndex } from "@/.server/chain/puh-index";
import { readBodyAtMost } from "@/.server/request";
import { type SafeCheck, burstsRunning } from "@/.server/safe/store";
import { onScreenSafeChecks } from "@/.server/signatures";
import { eraHeadsFor } from "@/.server/sync/content-engine";
import { listSafeChecks, noteSigned, syncView, wakeSync } from "@/.server/sync/engine";
import {
  BEAT_EVERY_MS,
  PRESENCE_LIMITS,
  isL2Key,
  isOwnBeat,
  parseBeat,
  presence,
  requestInfo,
} from "@/.server/sync/presence";
import { compareRevs, currentRev, notedHead, revNotedHead } from "@/.server/sync/revs";
import { type ActionFunctionArgs, json } from "@remix-run/node";

// A visible tab's beat (components/presence.tsx): the app is in use while tabs beat, and the
// engine follows the chain for what they show (sync/presence.ts). Only this app's own pages may
// beat (a JSON body, same origin); anything else is refused and nothing is recorded. The beat is
// answered from memory: it never sends a request upstream (it may wake the engine, or start the
// reads of the viewer's own Safe after they signed, which then read on their own), and it is never
// logged (server/middlewares/logger.ts).

export type BeatAnswer = {
  /**
   * Keys whose content changed since the revision the tab rendered (sync/revs.ts): the new content
   * is in memory, so the tab reloads its data (from memory).
   */
  changed: string[];
  /** Keys the server has no revision for (a restart, or forgotten): the tab reloads once. */
  unknown: string[];
  /** The engine has just started and is still reading the blocks it missed. */
  catchingUp: boolean;
  /** The newest head the engine served, or null. */
  head: { number: string; hash: string; timestamp: string } | null;
  /**
   * For each signature set on screen that can still be signed (by its key): how the Safe copies
   * of its members not valid yet are kept (checked every N s, paused, only on request); for each
   * list fed by Safe on screen, how the Safes it collects from are. Only for an item whose content
   * the tab shows is the current one (its revision): a check that changed what the tab shows is
   * not said beside the content from before it (the tab reloads, and its new content says it).
   */
  checked: Record<string, SafeCheck>;
  /**
   * For each signature set of the tab (`set:` keys) whose content is the current one (its
   * revision, repeated here): the newest head that content was verified at. A set the tab shows
   * that is not named here, or named at a block before `head`, was not verified at the head
   * served now (its reads failed, it needs Safe, or it has not run yet): the page shows it as of
   * its block, never as current (components/verification/freshness.tsx setCurrency).
   */
  verifiedAt: Record<string, { rev: string; block: string }>;
  /**
   * For each item of the tab other than ZKsync Era's (the root status, an upgrade's state, a list,
   * a transaction's receipt, a set, a simulation), by the revision the tab shows (repeated here):
   * the newest head that content was noted at (read there, or read again there with the same
   * result). For content that is the current one, the newest head; for content that changed (or
   * was touched) since, the head it was last noted at before it did (sync/revs.ts revNotedHead),
   * while the tab still shows it (its reload waits for the viewer, or for the reload gap). An item
   * named at a block before `head` was not read again at the head served now (its reads failed,
   * what it needs is not in memory there, or what was read there is not what the tab shows): the
   * page shows it as of that block, never as current
   * (components/verification/content-currency.tsx). Era items have `eraAt`.
   */
  notedAt: Record<string, { rev: string; block: string }>;
  /**
   * For each ZKsync Era item of the tab whose content is the current one (its revision): the Era
   * head that content was last read at. A head whose reads failed is never named.
   */
  eraAt: Record<string, { number: string; readAt: string }>;
  /** The oldest of `eraAt`, or null (kept for older pages). */
  era: { number: string; readAt: string } | null;
  /**
   * For each simulation of the tab (`sim:` keys) whose result is the current one (its revision):
   * the newest block it was simulated at with that result. A page shows a result as current only
   * at the head served (`head`).
   */
  simulatedAt: Record<string, string>;
  /** The handler's log history index, for the header. */
  index: PuhIndexStatus | null;
  /**
   * When to beat next: 10 s; 5 s while the viewer's own Safe is read; 2 s while settling, and
   * after a beat that named content as changed (its reload lands meanwhile, and the next beat
   * names the new content's block instead of the old one's).
   */
  nextMs: number;
};

// While the viewer's own Safe is being read after they signed, tabs beat more often.
const BURST_BEAT_MS = 5_000;
// While the engine catches up after a pause, or the log index backfills, the header's state
// ("Checking for changes…", "Indexing 37%") follows it closely, and after a change, the label of
// what the tab reloaded: a beat costs nothing upstream.
const SETTLING_BEAT_MS = 2_000;

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: number, error: string) => json({ error }, { status, headers: NO_STORE });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return refuse(405, "Beats are POSTed.");
  const origin = new URL(request.url).origin;
  if (!isOwnBeat(requestInfo(request), origin))
    return refuse(403, "Beats come from this app's own pages, as JSON.");
  const text = await readBodyAtMost(request, PRESENCE_LIMITS.bodyBytes);
  if (text === null) return refuse(413, "Beat too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "Not a beat.");
  }
  const beat = parseBeat(body);
  if (!beat) return refuse(400, "Not a beat.");
  presence().beat(beat);
  if (beat.reason !== "leave") wakeSync();
  if (beat.reason === "signed" && beat.signed) noteSigned(beat.signed.safe);
  return json(answer(beat.items), { headers: NO_STORE });
}

function answer(items: Parameters<typeof compareRevs>[0]): BeatAnswer {
  const { head, catchingUp } = syncView();
  const { changed, unknown } = compareRevs(items);
  const eraAt = eraHeadsFor(items);
  const index = puhIndex().status();
  let era: BeatAnswer["era"] = null;
  for (const read of Object.values(eraAt))
    if (era === null || BigInt(read.number) < BigInt(era.number)) era = read;
  return {
    changed,
    unknown,
    catchingUp,
    head: head && {
      number: head.number.toString(),
      hash: head.hash,
      timestamp: head.timestamp.toString(),
    },
    checked: {
      ...Object.fromEntries(
        Object.entries(onScreenSafeChecks()).filter(([key]) => isCurrent(items, key))
      ),
      ...listSafeChecks(items.filter((item) => isCurrent(items, item.key)).map((item) => item.key)),
    },
    verifiedAt: verifiedAt(items),
    notedAt: notedAt(items),
    eraAt,
    era,
    simulatedAt: simulatedAt(items),
    index,
    nextMs:
      catchingUp || index.state === "backfilling" || changed.length > 0
        ? SETTLING_BEAT_MS
        : burstsRunning() > 0
          ? BURST_BEAT_MS
          : BEAT_EVERY_MS,
  };
}

/** The tab renders this key's current content (the revision it beat with is the server's). */
function isCurrent(items: Parameters<typeof compareRevs>[0], key: string): boolean {
  const rev = currentRev(key);
  return rev !== null && items.some((item) => item.key === key && item.rev === rev);
}

function verifiedAt(
  items: Parameters<typeof compareRevs>[0]
): Record<string, { rev: string; block: string }> {
  const at: Record<string, { rev: string; block: string }> = {};
  for (const { key, rev } of items) {
    if (!key.startsWith("set:") || rev === null || rev !== currentRev(key)) continue;
    const head = notedHead(key);
    // A dev node's sets are read at 'latest' (noted at 0): no block to name.
    if (head !== null && head > 0n) at[key] = { rev, block: head.toString() };
  }
  return at;
}

function notedAt(
  items: Parameters<typeof compareRevs>[0]
): Record<string, { rev: string; block: string }> {
  const at: Record<string, { rev: string; block: string }> = {};
  for (const { key, rev } of items) {
    if (isL2Key(key) || rev === null) continue;
    // The content the tab shows, current or changed since: never a newer head than it was read at.
    const head = revNotedHead(key, rev);
    // A dev node's content is read at 'latest' (noted at 0): no block to name.
    if (head !== null && head > 0n) at[key] = { rev, block: head.toString() };
  }
  return at;
}

function simulatedAt(items: Parameters<typeof compareRevs>[0]): Record<string, string> {
  const at: Record<string, string> = {};
  for (const { key, rev } of items) {
    if (!key.startsWith("sim:") || rev === null || rev !== currentRev(key)) continue;
    const head = notedHead(key);
    if (head !== null) at[key] = head.toString();
  }
  return at;
}
