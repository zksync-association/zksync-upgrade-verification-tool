import { createHash } from "node:crypto";
import { linkStore } from "../cache";
import type { WatchItem } from "./presence";

// Revisions of what pages show, so an open page learns that something it renders changed and
// reloads its data, from memory, without asking anything upstream. A revision is bumped only once
// the new content is in memory (it is digested there) and differs from content noted at the same or
// an older point; labels (block numbers, copy ages) are not digested. A supplied signature (?sig=)
// never enters a key or a revision.

export type ContentAt = {
  head: bigint;
  /** Higher for newer inputs at the same head (e.g. the newest Safe listing version used). */
  order?: number;
};

type Entry = {
  digest: string;
  head: bigint;
  order: number;
  seq: number;
  touchedAt: number;
  // Earlier revisions: a tab may still show one (its reload held while the viewer signs).
  past: { seq: number; head: bigint }[];
};

const LIMIT = 512;
const PAST_LIMIT = 4;

const entries = new Map<string, Entry>();
let seq = 0;

export function contentDigest(content: unknown): string {
  const text = JSON.stringify(content, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
  return createHash("sha256")
    .update(text ?? "null")
    .digest("hex")
    .slice(0, 32);
}

const later = (a: { head: bigint; order: number }, b: { head: bigint; order: number }) =>
  a.head > b.head || (a.head === b.head && a.order > b.order);

// Content from an older point than the last noted that differs from it gets rev "0": never current,
// so the page that shows it reloads.
export function noteContent(key: string, at: ContentAt, content: unknown): WatchItem {
  return noteDigest(key, at, contentDigest(content));
}

export function noteDigest(key: string, at: ContentAt, digest: string): WatchItem {
  const point = { head: at.head, order: at.order ?? 0 };
  const now = Date.now();
  const entry = entries.get(key);
  if (!entry) {
    entries.set(key, { digest, ...point, seq: ++seq, touchedAt: now, past: [] });
    prune();
    return { key, rev: String(seq) };
  }
  entries.delete(key);
  entries.set(key, entry);
  entry.touchedAt = now;
  if (entry.digest === digest) {
    if (later(point, entry)) {
      entry.head = point.head;
      entry.order = point.order;
    }
    return { key, rev: String(entry.seq) };
  }
  if (later(point, entry) || (point.head === entry.head && point.order === entry.order)) {
    rememberPast(entry);
    entry.digest = digest;
    entry.head = point.head;
    entry.order = point.order;
    entry.seq = ++seq;
    return { key, rev: String(entry.seq) };
  }
  return { key, rev: "0" };
}

// The digest of a key whose content is known to be out of date (touchRev): no content has it.
const TOUCHED = "touched";

function rememberPast(entry: Entry) {
  if (entry.digest === TOUCHED) return;
  entry.past.unshift({ seq: entry.seq, head: entry.head });
  if (entry.past.length > PAST_LIMIT) entry.past.length = PAST_LIMIT;
}

/** A new revision without content, so the pages showing the key reload and note it anew. */
export function touchRev(key: string) {
  const entry = entries.get(key);
  if (!entry || entry.digest === TOUCHED) return;
  rememberPast(entry);
  entry.digest = TOUCHED;
  entry.seq = ++seq;
}

export function currentRev(key: string): string | null {
  const entry = entries.get(key);
  return entry ? String(entry.seq) : null;
}

export function notedHead(key: string): bigint | null {
  const entry = entries.get(key);
  return entry && entry.digest !== TOUCHED ? entry.head : null;
}

export function revNotedHead(key: string, rev: string): bigint | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (rev === String(entry.seq)) return entry.digest !== TOUCHED ? entry.head : null;
  return entry.past.find((past) => String(past.seq) === rev)?.head ?? null;
}

export function compareRevs(items: readonly WatchItem[]): { changed: string[]; unknown: string[] } {
  const changed: string[] = [];
  const unknown: string[] = [];
  for (const { key, rev } of items) {
    if (rev === null) continue;
    const entry = entries.get(key);
    if (!entry) unknown.push(key);
    else if (rev !== String(entry.seq)) changed.push(key);
  }
  return { changed, unknown };
}

function prune() {
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value as string);
}

export function resetRevs() {
  entries.clear();
}

// A settings change (and a dev node's refresh): revisions from before say nothing of content now.
linkStore("revs:", (prefix) => {
  if (prefix === null) resetRevs();
});
