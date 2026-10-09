import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";

// The root loader reads the app status every page shares: the network, governance roles,
// thresholds, freeze state and nonces, log history and the sync state. The root reads it again:
// - after Refresh or a settings save (their submissions);
// - when the app asked for it (requestStatusRevalidation): Refresh itself, signing, a mined
//   transaction on the transaction page, the log index finishing its backfill. The request holds
//   until a status read after it has landed (noteStatusLanded), so a navigation that cuts that
//   reload short reads the status in its place;
// - on any navigation or revalidation once the status in hand is older than 30 s, the server's
//   own bound for governance.
// Otherwise it keeps the status in hand: a search-param navigation (?history=all, ?sig=, freeze
// and veto parameters), another route's action (the home lookup, Simulate) or a page's own
// polling (the transaction page) within those 30 s. The header shows how old its block is.

/** Submissions after which the root reads the status again. */
export const STATUS_ACTIONS = ["/resources/refresh", "/settings"] as const;

/** How long the status in hand is kept before any navigation or revalidation reads it again. */
export const STATUS_MAX_AGE_MS = 30_000;

// Requests count up; a root read decided after request n answers it once its status lands.
let requested = 0;
let answered = 0;
let readFor = 0;
// The status in hand and when it landed (this browser's clock); null before the first one.
let landed: object | null = null;
let landedAt: number | null = null;

/**
 * Makes the root read the status again on the next revalidation or navigation, and on every one
 * after it until a status read after this call has landed. Call it right before
 * `revalidator.revalidate()` (or a submission) when the status may have changed.
 */
export function requestStatusRevalidation() {
  requested += 1;
}

/** The app shell calls this with each root status it renders; a status it saw before is ignored. */
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

/** The root route's `shouldRevalidate`. */
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

/** Forgets every request and the landed status (tests). */
export function resetStatusRevalidation() {
  requested = 0;
  answered = 0;
  readFor = 0;
  landed = null;
  landedAt = null;
}
