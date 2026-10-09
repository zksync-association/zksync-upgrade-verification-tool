import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";

// The root reads the app status again after Refresh or a settings save, when the app asked for it
// (requestStatusRevalidation: held until a status read after it has landed, so a navigation that
// cuts that reload short reads it instead), and on any navigation or revalidation once the status
// in hand is older than 30 s (the server's own bound for governance); otherwise it keeps it.

export const STATUS_ACTIONS = ["/resources/refresh", "/settings"] as const;

export const STATUS_MAX_AGE_MS = 30_000;

// Requests count up; a root read decided after request n answers it once its status lands.
let requested = 0;
let answered = 0;
let readFor = 0;
let landed: object | null = null;
let landedAt: number | null = null;

/** Call right before `revalidator.revalidate()` (or a submission) when the status may differ. */
export function requestStatusRevalidation() {
  requested += 1;
}

export function noteStatusLanded(status: object, now = Date.now()) {
  if (status === landed) return;
  landed = status;
  answered = Math.max(answered, readFor);
  landedAt = now;
}

type RootRevalidateArgs = Pick<
  ShouldRevalidateFunctionArgs,
  "formMethod" | "formAction" | "defaultShouldRevalidate"
>;

export function shouldRevalidateRoot(args: RootRevalidateArgs): boolean {
  const read =
    requested > answered ||
    landedAt === null ||
    Date.now() - landedAt > STATUS_MAX_AGE_MS ||
    (isStatusSubmission(args) && args.defaultShouldRevalidate);
  if (read) readFor = requested;
  return read;
}

function isStatusSubmission({ formMethod, formAction }: RootRevalidateArgs): boolean {
  if (!formMethod || !formAction || formMethod.toUpperCase() === "GET") return false;
  const path = new URL(formAction, "http://app.invalid").pathname.replace(/\/+$/, "") || "/";
  return (STATUS_ACTIONS as readonly string[]).includes(path);
}

export function resetStatusRevalidation() {
  requested = 0;
  answered = 0;
  readFor = 0;
  landed = null;
  landedAt = null;
}
