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

// A visible tab's beat (components/presence.tsx): the app is in use while tabs beat. Only this
// app's own pages may beat (same origin, JSON); anything else is refused and nothing is recorded.
// Answered from memory, never upstream (it may wake the engine or start the viewer's own Safe
// reads), and never logged.

export type BeatAnswer = {
  changed: string[];
  unknown: string[];
  catchingUp: boolean;
  head: { number: string; hash: string; timestamp: string } | null;
  /** Only for items the tab shows at their current revision: never beside older content. */
  checked: Record<string, SafeCheck>;
  /** A set not named here, or named before `head`, is shown as of its block, never as current. */
  verifiedAt: Record<string, { rev: string; block: string }>;
  /** A non-Era item named at a block before `head` is shown as of that block, never as current. */
  notedAt: Record<string, { rev: string; block: string }>;
  /** A head whose reads failed is never named. */
  eraAt: Record<string, { number: string; readAt: string }>;
  /** The oldest of `eraAt`, or null (kept for older pages). */
  era: { number: string; readAt: string } | null;
  /** A page shows a simulation as current only at the head served (`head`). */
  simulatedAt: Record<string, string>;
  index: PuhIndexStatus | null;
  nextMs: number;
};

const BURST_BEAT_MS = 5_000;
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
