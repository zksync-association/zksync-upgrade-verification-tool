import { formatEther } from "viem";

export function shortHex(value: string, start = 6, end = 4) {
  return value.length <= start + end + 3 ? value : `${value.slice(0, start)}…${value.slice(-end)}`;
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Unix seconds (number or decimal string) or ISO string → "Sep 30, 2026, 09:31 UTC". */
export function formatTime(value: number | string | null | undefined) {
  const date = toDate(value);
  return date ? `${dateTime.format(date)} UTC` : "—";
}

export function formatDay(value: number | string | null | undefined) {
  const date = toDate(value);
  return date ? dateOnly.format(date) : "—";
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

export function formatEth(wei: string) {
  return `${formatEther(BigInt(wei))} ETH`;
}

export function formatNumber(value: string | number) {
  return Number(value).toLocaleString("en-US");
}
