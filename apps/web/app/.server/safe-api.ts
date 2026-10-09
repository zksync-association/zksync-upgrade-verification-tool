import { env } from "@config/env.server";
import { defaultLogger } from "@config/log.server";
import { hexSchema } from "@repo/common/schemas";
import { type Address, type Hex, getAddress } from "viem";
import { z } from "zod";
import { cached, invalidate } from "./cache";
import { network } from "./rpc";
import { countUpstream } from "./sync/cost";

// Read-only client for the Safe Transaction Service. Its answers are untrusted input: callers only
// ever use a message whose hash they computed themselves, and a signature only once the governance
// contract has accepted it in an eth_call. The app never POSTs to Safe.

const log = defaultLogger.child({ module: "safe-api" });

const confirmationSchema = z.object({
  owner: z.string(),
  signature: hexSchema,
  signatureType: z.string(),
});

export const safeMessageSchema = z.object({
  created: z.string(),
  modified: z.string(),
  safe: z.string(),
  messageHash: hexSchema,
  message: z.unknown(),
  proposedBy: z.string().nullable().optional(),
  confirmations: z.array(confirmationSchema),
  preparedSignature: hexSchema.nullable().optional(),
});

const listSchema = z.object({
  count: z.number(),
  results: z.array(safeMessageSchema),
});

export type SafeMessage = z.infer<typeof safeMessageSchema>;
export type SafeMessages = { messages: SafeMessage[]; complete: boolean };

export type SafeListing = SafeMessages & { count: number; arrivedAt: number };

export type NewestMessage = { count: number; messageHash: Hex | null; modified: string | null };

export class SafeApiError extends Error {}

/** "high": a request waits on it; "low": background (promoted once a request waits on it). */
export type SafeTicket = { priority: "high" | "low" };

export type SafeRequestOptions = {
  ticket?: SafeTicket;
  beforeQueue?: () => void;
  beforeRequest?: () => void;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MESSAGE_TTL_MS = 60_000;
// Safe answers 429 at 8 requests in flight.
const MAX_IN_FLIGHT = 4;
// A page's request always finds a slot free: background requests hold at most this many.
const MAX_BACKGROUND_IN_FLIGHT = 2;

// api.safe.global allows 2 requests/s without a key (5/s with one) and 5,000 a month per IP.
// A self-hosted Transaction Service has no such limits.
const minIntervalMs = () => (env.SAFE_API_KEY ? 220 : 550);

export function isPublicSafeService(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.safe.global";
  } catch {
    return false;
  }
}

/**
 * Background reads only with a key or on a self-hosted service: keyless ones would spend the public
 * service's 5,000-a-month per-IP quota that the pages need.
 */
export function backgroundSafeReadsAllowed(
  baseUrl: string,
  apiKey: string | undefined = env.SAFE_API_KEY
): boolean {
  return !!apiKey || !isPublicSafeService(baseUrl);
}

let clientGeneration = 0;

export function safeClientGeneration(): number {
  return clientGeneration;
}

let cooldown: { until: number; error: SafeApiError; exhausted: boolean } | null = null;
const failures = new Map<string, { until: number; error: SafeApiError }>();

function checkCooldown() {
  if (!cooldown) return;
  if (Date.now() < cooldown.until) throw cooldown.error;
  cooldown = null;
}

export function safeCooldownUntil(): number | null {
  return cooldown && Date.now() < cooldown.until ? cooldown.until : null;
}

export function safeCooldownError(): SafeApiError | null {
  return cooldown && Date.now() < cooldown.until ? cooldown.error : null;
}

export function safeQuotaExhausted(): boolean {
  return !!cooldown && Date.now() < cooldown.until && cooldown.exhausted;
}

// Requests start one at a time, minIntervalMs() apart on the public service, at most MAX_IN_FLIGHT
// in flight (MAX_BACKGROUND_IN_FLIGHT of them background); those a page waits on go first.
type Waiter = {
  ticket: SafeTicket;
  spaced: boolean;
  resolve: (low: boolean) => void;
  reject: (error: Error) => void;
};
let waiting: Waiter[] = [];
let inFlight = 0;
let lowInFlight = 0;
let nextSlot = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

function pump() {
  while (waiting.length > 0 && inFlight < MAX_IN_FLIGHT) {
    const high = waiting.findIndex((w) => w.ticket.priority === "high");
    if (high === -1 && lowInFlight >= MAX_BACKGROUND_IN_FLIGHT) return;
    const index = high === -1 ? 0 : high;
    const waiter = waiting[index] as Waiter;
    if (waiter.spaced) {
      const now = Date.now();
      // A clock stepped back (NTP) never holds requests up for longer than one interval.
      if (nextSlot - now > minIntervalMs()) nextSlot = now + minIntervalMs();
      if (now < nextSlot) {
        pumpTimer ??= setTimeout(() => {
          pumpTimer = null;
          pump();
        }, nextSlot - now);
        return;
      }
      nextSlot = now + minIntervalMs();
    }
    waiting.splice(index, 1);
    inFlight++;
    const low = waiter.ticket.priority === "low";
    if (low) lowInFlight++;
    waiter.resolve(low);
  }
}

async function acquire(ticket: SafeTicket, spaced: boolean): Promise<() => void> {
  const low = await new Promise<boolean>((resolve, reject) => {
    waiting.push({ ticket, spaced, resolve, reject });
    pump();
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight--;
    if (low) lowInFlight--;
    pump();
  };
}

function rejectWaiting(error: Error) {
  const rejected = waiting;
  waiting = [];
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = null;
  nextSlot = 0;
  for (const waiter of rejected) waiter.reject(error);
}

function pauseRequests(ms: number, message: string, exhausted = false): SafeApiError {
  // An older in-flight response must not shorten a quota cooldown established by another request.
  if (cooldown && cooldown.until >= Date.now() + ms) return cooldown.error;
  const error = new SafeApiError(message);
  cooldown = { until: Date.now() + ms, error, exhausted };
  // Release requests waiting for a slot: they should fail promptly, not keep queueing.
  rejectWaiting(error);
  return error;
}

function secondsHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

function retryDelay(value: string | null): number {
  return (secondsHeader(value) ?? Math.max(0, Date.parse(value ?? "") - Date.now())) || 2_000;
}

const settingsChanged = () =>
  new SafeApiError("Data source settings changed. Refresh to check signatures again.");

/** The quota the service last reported (x-ratelimit-limit, -remaining and -reset). */
export const quota = {
  limit: null as number | null,
  remaining: null as number | null,
  resetAt: null as number | null,
};

// x-ratelimit-reset: seconds from now (the public service reports about 2.6 million, the rest of
// the month), or an epoch time in seconds when that large.
function resetAtOf(value: string | null, now: number): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds >= 1_000_000_000 ? seconds * 1_000 : now + seconds * 1_000;
}

async function getJson(
  path: string,
  { ticket = { priority: "high" }, beforeQueue, beforeRequest }: SafeRequestOptions = {}
): Promise<{ body: unknown | null; arrivedAt: number }> {
  const generation = clientGeneration;
  const checkGeneration = () => {
    if (generation !== clientGeneration) throw settingsChanged();
  };
  checkCooldown();
  const failure = failures.get(path);
  if (failure && Date.now() < failure.until) throw failure.error;
  failures.delete(path);
  const { safeTxServiceUrl } = await network();
  if (!safeTxServiceUrl) {
    throw new SafeApiError("No Safe Transaction Service for this chain. Set SAFE_TX_SERVICE_URL.");
  }

  beforeQueue?.();
  const release = await acquire(ticket, isPublicSafeService(safeTxServiceUrl));
  try {
    checkCooldown();
    checkGeneration();
    beforeRequest?.();
    countUpstream("safe");
    let response: Response;
    try {
      response = await fetch(`${safeTxServiceUrl}${path}`, {
        headers: {
          accept: "application/json",
          ...(env.SAFE_API_KEY ? { authorization: `Bearer ${env.SAFE_API_KEY}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      checkGeneration();
      const unavailable = new SafeApiError(
        `Safe Transaction Service unreachable: ${(error as Error).message}`
      );
      failures.set(path, { until: Date.now() + 15_000, error: unavailable });
      throw unavailable;
    }
    const arrivedAt = Date.now();

    checkGeneration();
    const limit = response.headers.get("x-ratelimit-limit");
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (limit !== null && Number.isFinite(Number(limit))) quota.limit = Number(limit);
    if (remaining !== null && Number.isFinite(Number(remaining)))
      quota.remaining = Number(remaining);
    const resetAt = resetAtOf(response.headers.get("x-ratelimit-reset"), arrivedAt);
    if (resetAt !== null) quota.resetAt = resetAt;

    if (response.status === 404) return { body: null, arrivedAt };
    if (response.status === 429) {
      const body = await response.text();
      const exhausted = remaining === "0" || /monthly quota exceeded/i.test(body);
      const wait = exhausted
        ? secondsHeader(response.headers.get("x-ratelimit-reset")) ?? 60_000
        : retryDelay(response.headers.get("retry-after"));
      log.warn({ path, exhausted, cooldownMs: wait }, "Safe API requests paused");
      throw pauseRequests(
        Math.max(wait, 1_000),
        exhausted
          ? "Safe Transaction Service monthly quota exhausted. Signature copies are unavailable until the quota resets or service access is updated."
          : "Safe Transaction Service is temporarily rate limited. Signature copies are unavailable; retry after the cooldown.",
        exhausted
      );
    }
    if (!response.ok) {
      const error = new SafeApiError(
        `Safe Transaction Service returned HTTP ${response.status} for ${path}`
      );
      failures.set(path, { until: Date.now() + 15_000, error });
      throw error;
    }
    const body: unknown = await response.json();
    checkGeneration();
    return { body, arrivedAt };
  } finally {
    release();
  }
}

const messagesPath = (safe: Address, query: string) =>
  `/api/v1/safes/${getAddress(safe)}/messages/?${query}`;

/** A Safe's newest messages (governance actions are recent, so a few pages cover them). */
export async function fetchListing(
  safe: Address,
  options: SafeRequestOptions = {}
): Promise<SafeListing> {
  const messages: SafeMessage[] = [];
  let total = 0;
  let arrivedAt: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await getJson(
      messagesPath(safe, `limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&ordering=-created`),
      options
    );
    arrivedAt ??= answer.arrivedAt;
    if (answer.body === null)
      return { messages, complete: true, count: messages.length, arrivedAt };
    const parsed = listSchema.safeParse(answer.body);
    if (!parsed.success) {
      throw new SafeApiError(`Unexpected Safe Transaction Service response for ${safe}`);
    }
    total = parsed.data.count;
    messages.push(...parsed.data.results);
    if (messages.length >= total || parsed.data.results.length < PAGE_SIZE) break;
  }
  return {
    messages,
    complete: messages.length >= total,
    count: total,
    arrivedAt: arrivedAt ?? Date.now(),
  };
}

/**
 * The cheapest change check (Safe ignores time filters): a new or deleted message moves the count,
 * a new confirmation the newest `modified`.
 */
export async function fetchNewest(
  safe: Address,
  options: SafeRequestOptions = {}
): Promise<NewestMessage & { arrivedAt: number }> {
  const { body, arrivedAt } = await getJson(
    messagesPath(safe, "ordering=-modified&limit=1"),
    options
  );
  if (body === null) return { count: 0, messageHash: null, modified: null, arrivedAt };
  const parsed = listSchema.safeParse(body);
  if (!parsed.success) {
    throw new SafeApiError(`Unexpected Safe Transaction Service response for ${safe}`);
  }
  const newest = parsed.data.results[0];
  return {
    count: parsed.data.count,
    messageHash: newest?.messageHash ?? null,
    modified: newest?.modified ?? null,
    arrivedAt,
  };
}

/** Direct lookup by Safe message hash; null when Safe has no such message. */
export function getSafeMessage(messageHash: Hex): Promise<SafeMessage | null> {
  return cached(`safe:message:${messageHash.toLowerCase()}`, MESSAGE_TTL_MS, async () => {
    const { body } = await getJson(`/api/v1/messages/${messageHash}/`);
    if (body === null) return null;
    const parsed = safeMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new SafeApiError(`Unexpected Safe Transaction Service response for ${messageHash}`);
    }
    return parsed.data;
  });
}

let lastRefresh = 0;
/** Drops cached Safe answers, the store's included (at most every 10 s, to protect the quota). */
export function refreshSafeData(): boolean {
  if (Date.now() - lastRefresh < 10_000) return false;
  lastRefresh = Date.now();
  invalidate("safe:");
  return true;
}

export async function safeWalletUrl(safe: Address): Promise<string | null> {
  const { safeWalletPrefix } = await network();
  return safeWalletPrefix
    ? `https://app.safe.global/home?safe=${safeWalletPrefix}:${getAddress(safe)}`
    : null;
}

export function resetSafeClient() {
  clientGeneration++;
  // Requests in flight keep their slots until answered (then dropped by their generation check).
  rejectWaiting(settingsChanged());
  cooldown = null;
  failures.clear();
  lastRefresh = 0;
  quota.limit = null;
  quota.remaining = null;
  quota.resetAt = null;
}
