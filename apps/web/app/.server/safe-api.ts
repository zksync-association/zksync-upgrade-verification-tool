import { env } from "@config/env.server";
import { defaultLogger } from "@config/log.server";
import { hexSchema } from "@repo/common/schemas";
import { type Address, type Hex, getAddress } from "viem";
import { z } from "zod";
import { cached, invalidate } from "./cache";
import { network } from "./rpc";

// Read-only client for the Safe Transaction Service. Its answers are untrusted input: callers only
// ever use a message whose hash they computed themselves, and a signature only once the governance
// contract has accepted it in an eth_call. The app never POSTs to Safe.

const log = defaultLogger.child({ module: "safe-api" });

const confirmationSchema = z.object({
  owner: z.string(),
  signature: hexSchema,
  signatureType: z.string(),
});

const messageSchema = z.object({
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
  results: z.array(messageSchema),
});

export type SafeMessage = z.infer<typeof messageSchema>;
export type SafeMessages = { messages: SafeMessage[]; complete: boolean };

/** One read of a Safe's listing: `count` is the service's total, `arrivedAt` its first answer. */
export type SafeListing = SafeMessages & { count: number; arrivedAt: number };

/** The Safe's most recently modified message, and how many it has (the store's change check). */
export type NewestMessage = { count: number; messageHash: Hex | null; modified: string | null };

export class SafeApiError extends Error {}

/**
 * A read's place in the queue: "high" for what a request waits on, "low" for background reads.
 * A background read that a request then waits on is promoted (its priority set to "high").
 */
export type SafeTicket = { priority: "high" | "low" };

export type SafeRequestOptions = {
  ticket?: SafeTicket;
  /** Runs before each request waits for a start slot; throwing cancels it without using one. */
  beforeQueue?: () => void;
  /** Runs as each request is about to be sent; throwing cancels it (a background budget). */
  beforeRequest?: () => void;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MESSAGE_TTL_MS = 60_000;
// Safe answers 429 at 8 requests in flight.
const MAX_IN_FLIGHT = 4;

// api.safe.global allows 2 requests/s without a key (5/s with one) and 5,000 a month per IP.
// A self-hosted Transaction Service has no such limits.
const minIntervalMs = () => (env.SAFE_API_KEY ? 220 : 550);

/** The public Safe Transaction Service (rate limited, with a monthly per-IP quota without a key). */
export function isPublicSafeService(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.safe.global";
  } catch {
    return false;
  }
}

/**
 * Whether reads nobody asked for yet (warm-up, background refresh) may be sent to this service:
 * with SAFE_API_KEY, or to a self-hosted service. Keyless reads of the public service would spend
 * the shared 5,000-a-month per-IP quota that the pages themselves need.
 */
export function backgroundSafeReadsAllowed(
  baseUrl: string,
  apiKey: string | undefined = env.SAFE_API_KEY
): boolean {
  return !!apiKey || !isPublicSafeService(baseUrl);
}

let clientGeneration = 0;

/** The settings generation the Safe client runs for; resetSafeClient() starts a new one. */
export function safeClientGeneration(): number {
  return clientGeneration;
}

let cooldown: { until: number; error: SafeApiError } | null = null;
const failures = new Map<string, { until: number; error: SafeApiError }>();

function checkCooldown() {
  if (!cooldown) return;
  if (Date.now() < cooldown.until) throw cooldown.error;
  cooldown = null;
}

/** When the current rate-limit / quota cooldown ends, or null when there is none. */
export function safeCooldownUntil(): number | null {
  return cooldown && Date.now() < cooldown.until ? cooldown.until : null;
}

// The pacer: requests start one at a time, at least minIntervalMs() apart on the public service,
// with at most MAX_IN_FLIGHT in flight anywhere. Waiting requests a page needs ("high") start
// before background ones ("low"), whatever their order of arrival. Requests sent before a
// settings change count until they are answered: they are still in flight at the service.
type Waiter = {
  ticket: SafeTicket;
  spaced: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};
let waiting: Waiter[] = [];
let inFlight = 0;
let nextSlot = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

function pump() {
  while (waiting.length > 0 && inFlight < MAX_IN_FLIGHT) {
    const high = waiting.findIndex((w) => w.ticket.priority === "high");
    const index = high === -1 ? 0 : high;
    const waiter = waiting[index] as Waiter;
    if (waiter.spaced) {
      const now = Date.now();
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
    waiter.resolve();
  }
}

/** Waits for a start slot; resolves to the release to call once the response was read. */
async function acquire(ticket: SafeTicket, spaced: boolean): Promise<() => void> {
  await new Promise<void>((resolve, reject) => {
    waiting.push({ ticket, spaced, resolve, reject });
    pump();
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight--;
    pump();
  };
}

/** Fails every request still waiting for a slot. */
function rejectWaiting(error: Error) {
  const rejected = waiting;
  waiting = [];
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = null;
  nextSlot = 0;
  for (const waiter of rejected) waiter.reject(error);
}

function pauseRequests(ms: number, message: string): SafeApiError {
  // An older in-flight response must not shorten a quota cooldown established by another request.
  if (cooldown && cooldown.until >= Date.now() + ms) return cooldown.error;
  const error = new SafeApiError(message);
  cooldown = { until: Date.now() + ms, error };
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

export const quota = { limit: null as number | null, remaining: null as number | null };

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
          : "Safe Transaction Service is temporarily rate limited. Signature copies are unavailable; retry after the cooldown."
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

/**
 * Reads a Safe's newest messages (governance actions are recent, so a few pages cover them).
 * Callers read listings through the snapshot store (safe/store.ts), which decides when to.
 */
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
 * One small request that tells whether a Safe's listing changed: a new message raises the count,
 * a deleted one lowers it, and a new confirmation sets the message's `modified` (so it becomes the
 * newest by modification). Safe ignores time filters, so this is the cheapest check there is.
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
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      throw new SafeApiError(`Unexpected Safe Transaction Service response for ${messageHash}`);
    }
    return parsed.data;
  });
}

let lastRefresh = 0;
/**
 * Drops cached Safe answers, the snapshot store's listings included (at most every 10 s, to
 * protect the shared quota).
 */
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
}
