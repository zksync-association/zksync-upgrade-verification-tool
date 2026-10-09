import { puhIndex } from "@/.server/chain/puh-index";
import { syncView, wakeSync } from "@/.server/sync/engine";
import {
  BEAT_EVERY_MS,
  PRESENCE_LIMITS,
  isOwnBeat,
  parseBeat,
  presence,
  requestInfo,
} from "@/.server/sync/presence";
import { indexProgress } from "@/components/sync-state";
import { type ActionFunctionArgs, json } from "@remix-run/node";

// A visible tab's beat (components/presence.tsx): the app is in use while tabs beat, and the
// engine follows the chain for what they show (sync/presence.ts). Only this app's own pages may
// beat (a JSON body, same origin); anything else is refused and nothing is recorded. The beat is
// answered from memory: it never sends a request upstream (it may wake the engine, which then
// reads on its own), and it is never logged (server/middlewares/logger.ts).

export type BeatAnswer = {
  /** Keys whose content changed since the revision the tab holds (none yet). */
  changed: string[];
  /** Keys the server does not know (none yet). */
  unknown: string[];
  /** The engine has just started and is still reading the blocks it missed. */
  catchingUp: boolean;
  /** The newest head the engine served, or null. */
  head: { number: string; hash: string; timestamp: string } | null;
  /** Per key, how far it is known current (none yet). */
  checked: Record<string, never>;
  /** The handler's log history backfill, for the header. */
  index: { state: string; percent: number | null } | null;
  /** When to beat next. */
  nextMs: number;
};

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: number, error: string) => json({ error }, { status, headers: NO_STORE });

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return refuse(405, "Beats are POSTed.");
  const origin = new URL(request.url).origin;
  if (!isOwnBeat(requestInfo(request), origin))
    return refuse(403, "Beats come from this app's own pages, as JSON.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > PRESENCE_LIMITS.bodyBytes) return refuse(413, "Beat too large.");
  const text = await readAtMost(request, PRESENCE_LIMITS.bodyBytes);
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
  return json(answer(), { headers: NO_STORE });
}

function answer(): BeatAnswer {
  const { head, catchingUp } = syncView();
  const index = puhIndex().status();
  return {
    changed: [],
    unknown: [],
    catchingUp,
    head: head && {
      number: head.number.toString(),
      hash: head.hash,
      timestamp: head.timestamp.toString(),
    },
    checked: {},
    index: { state: index.state, percent: indexProgress(index).percent },
    nextMs: BEAT_EVERY_MS,
  };
}

/** The body as text, or null once it passes `max` bytes (the rest is not read). */
async function readAtMost(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
