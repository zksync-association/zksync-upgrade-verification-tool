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
