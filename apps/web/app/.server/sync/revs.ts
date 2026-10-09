import { createHash } from "node:crypto";
import { linkStore } from "../cache";
import type { WatchItem } from "./presence";

// Revisions of what pages show, so an open page learns that something it renders changed and
// reloads its data (components/presence.tsx), without asking anything upstream.
//
// Every item a page renders has a key (sync/presence.ts watchKeys, signatures.ts set keys). Its
// content is digested where it is assembled: by the page's loader for what it sends, and by the
// sync engine for what is on screen at each served head (and when a member Safe's listing
// changes). A key's revision changes when its content differs from the one assembled before at
// the same or an older point (a head, and for Safe-fed content the listing versions it used): it
// is bumped only once the new content is in memory, because only then is it digested. A tab
// beats with the revisions of what it rendered; a revision other than the key's current one means
// "changed" (the tab reloads, from memory), a key the server does not know means "unknown".
//
// Content is digested without its labels (block numbers, copy ages): a new head with the same
// content is no change. Nothing here reads anything; a supplied signature (?sig=) never enters a
// key or a revision (signatures.ts keys sets without them and digests only what it keeps).

/** Where content was assembled: the head it was read at, and an order among content at that head. */
export type ContentAt = {
  head: bigint;
  /** Higher for newer inputs at the same head (e.g. the newest Safe listing version used). */
  order?: number;
};

type Entry = {
  digest: string;
  head: bigint;
  order: number;
  /** The revision: a number from one sequence for every key, never reused. */
  seq: number;
  touchedAt: number;
};

// At most this many keys (the least recently noted go first): pages open at once show far fewer.
const LIMIT = 512;

const entries = new Map<string, Entry>();
let seq = 0;

/** A stable digest of JSON-like content (bigints as decimal strings, keys in insertion order). */
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

/**
 * Notes `content` of `key` as assembled at `at`, and returns the item a page that shows it reports
 * (`rev`). Content at a point not older than the last noted one replaces it (a new revision when
 * it differs); content from an older point that differs from it gets rev "0", which is never
 * current, so the page that shows it reloads.
 */
export function noteContent(key: string, at: ContentAt, content: unknown): WatchItem {
  return noteDigest(key, at, contentDigest(content));
}

/** noteContent with the digest already made. */
export function noteDigest(key: string, at: ContentAt, digest: string): WatchItem {
  const point = { head: at.head, order: at.order ?? 0 };
  const now = Date.now();
  const entry = entries.get(key);
  if (!entry) {
    entries.set(key, { digest, ...point, seq: ++seq, touchedAt: now });
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

/**
 * Something the key's content uses changed (a member Safe's listing on a dev node, where nothing
 * is verified ahead of requests; a member the engine found no longer valid from a copy it may not
 * use): a new revision, so the pages showing it reload and note their content anew. Nothing for a
 * key never noted, and nothing more for one touched since its content was last noted (the pages
 * showing it reload already).
 */
export function touchRev(key: string) {
  const entry = entries.get(key);
  if (!entry || entry.digest === TOUCHED) return;
  entry.digest = TOUCHED;
  entry.seq = ++seq;
}

/** The key's current revision, or null when the server has none (never noted, or forgotten). */
export function currentRev(key: string): string | null {
  const entry = entries.get(key);
  return entry ? String(entry.seq) : null;
}

/**
 * The newest head the key's current content was assembled at (the same content noted again at a
 * later head moves it), or null when the key has no content noted (or was touched since).
 */
export function notedHead(key: string): bigint | null {
  const entry = entries.get(key);
  return entry && entry.digest !== TOUCHED ? entry.head : null;
}

/**
 * For a tab's beat: of the items it renders, those whose content changed since the revision it
 * holds, and those the server has no revision for. An item without a revision (null: the page has
 * not rendered its content yet) is neither.
 */
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

/** Forgets every revision (tests, a settings change). */
export function resetRevs() {
  entries.clear();
}

// A settings change (and a dev node's refresh) drops everything cached: revisions of content from
// before it say nothing about the content now.
linkStore("revs:", (prefix) => {
  if (prefix === null) resetRevs();
});
