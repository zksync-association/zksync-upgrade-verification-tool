import { formatEther } from "viem";

export function shortHex(value: string, start = 6, end = 4) {
  return value.length <= start + end + 3 ? value : `${value.slice(0, start)}…${value.slice(-end)}`;
}

// Intl punctuation differs between Node and Safari (", " versus " at ").
// Assemble UTC fields explicitly so SSR and hydration render identical text.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (date: Date) =>
  `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;

/** Unix seconds (number or decimal string) or ISO string → "Sep 30, 2026, 09:31 UTC". */
export function formatTime(value: number | string | null | undefined) {
  const date = toDate(value);
  return date
    ? `${dayLabel(date)}, ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`
    : "—";
}

export function formatDay(value: number | string | null | undefined) {
  const date = toDate(value);
  return date ? dayLabel(date) : "—";
}

function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "" || value === 0 || value === "0")
    return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return new Date(value);
  return new Date(Number(value) * 1000);
}

/** "in 3 days" / "2 hours ago", relative to `now` (unix seconds, usually the latest block). */
export function relativeTime(value: number | string, now: number | string) {
  const delta = Number(value) - Number(now);
  const abs = Math.abs(delta);
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [seconds, unit] of units) {
    if (abs >= seconds) {
      const n = Math.floor(abs / seconds);
      const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
      return delta >= 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return delta >= 0 ? "in less than a minute" : "just now";
}

/** An age in seconds → "12s ago" / "3m ago" / "2h ago" / "4d ago". A negative age (clock skew) is 0. */
export function formatAge(seconds: number) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function formatEth(wei: string) {
  return `${formatEther(BigInt(wei))} ETH`;
}

export function formatNumber(value: string | number) {
  return Number(value).toLocaleString("en-US");
}
