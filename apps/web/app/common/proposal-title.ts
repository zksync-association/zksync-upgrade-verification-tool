// An L2 proposal's title is, by convention, the first line of its description ("# [ZIP-17] …").
// The proposer wrote it, so it is shown as plain text: no markdown, no control or
// direction-override characters (which could make it read differently), and a bounded length.
// Control and format characters (zero-width, bidirectional overrides, byte order mark).
const HIDDEN = /[\p{Cc}\p{Cf}]/gu;
const MAX = 160;

export function proposalTitle(description: string): string | null {
  for (const raw of description.split(/\r?\n/)) {
    const line = raw
      .replace(HIDDEN, "")
      .trim()
      .replace(/^#+\s*/, "")
      .trim();
    if (line === "") continue;
    return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
  }
  return null;
}

const SUMMARY_MAX = 280;
// Where proposals put their summary (ZKsync's template: "## Short Summary"); else the first
// paragraph long enough to say something.
const SUMMARY_HEADING = /^(short\s+)?summary$|^abstract$|^overview$|^tl;?dr$|^description$/i;
const MIN_PARAGRAPH = 60;

/**
 * What the proposal does, in a few plain-text sentences: the paragraph under its summary heading,
 * else its first real paragraph (not a heading, list, table, quote, code or HTML), markdown
 * removed and the length bounded. Null when there is none.
 */
export function proposalSummary(description: string): string | null {
  const lines = description.split(/\r?\n/).map((l) => l.replace(HIDDEN, "").trimEnd());
  // Paragraphs after the title, each with the heading it is under.
  const paragraphs: { heading: string | null; text: string[] }[] = [];
  let heading: string | null = null;
  let current: string[] = [];
  let titleSeen = false;
  let fenced = false;
  const close = () => {
    if (current.length > 0) paragraphs.push({ heading, text: current });
    current = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      close();
      continue;
    }
    if (fenced) continue;
    if (!titleSeen) {
      if (t !== "") titleSeen = true;
      continue;
    }
    if (t === "") {
      close();
      continue;
    }
    const h = /^#{1,6}\s*(.*)$/.exec(t);
    if (h) {
      close();
      heading = (h[1] ?? "").replace(/[*_:]/g, "").trim();
      continue;
    }
    current.push(t);
  }
  close();
  const prose = paragraphs.filter(
    ({ text }) => !/^([-*+]\s|\d+[.)]\s|\||>|<|---|\*\*\*)/.test(text[0] ?? "")
  );
  const pick =
    prose.find((p) => p.heading !== null && SUMMARY_HEADING.test(p.heading)) ??
    prose.find((p) => plain(p.text.join(" ")).length >= MIN_PARAGRAPH);
  if (!pick) return null;
  const text = plain(pick.text.join(" "));
  if (text === "") return null;
  if (text.length <= SUMMARY_MAX) return text;
  // Whole sentences where they fit; else cut at a word.
  const sentences = text.slice(0, SUMMARY_MAX).match(/^.*[.!?](?=\s)/)?.[0];
  if (sentences && sentences.length >= SUMMARY_MAX / 3) return sentences;
  const cut = text.slice(0, SUMMARY_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SUMMARY_MAX / 2)).trimEnd()}…`;
}

/** Markdown inline syntax removed: images, links (their text kept), emphasis, code ticks. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}
