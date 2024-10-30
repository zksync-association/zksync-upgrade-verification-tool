import { parseISO } from "date-fns";
import { format, toZonedTime } from "date-fns-tz";

export function dateToUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function formatDate(date: Date | string) {
  const parsedDate = typeof date === "string" ? parseISO(date) : date;
  return format(toZonedTime(parsedDate, "UTC"), "MMM dd, yyyy");
}

export function formatDateTime(date: Date | string) {
  const parsedDate = typeof date === "string" ? parseISO(date) : date;
  return `${format(toZonedTime(parsedDate, "UTC"), "MMM dd, yyyy, hh:mm:ss a")} UTC`;
}
