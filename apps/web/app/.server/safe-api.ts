import { setMaxListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
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

export class SafeApiError extends Error {}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const LIST_TTL_MS = 60_000;

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

let nextSlot = 0;
let clientGeneration = 0;
function requestQueue() {
  const controller = new AbortController();
  // A governance scan legitimately queues more than ten members on this signal.
  // The delay helper removes each listener when its timer resolves or is cancelled.
  setMaxListeners(0, controller.signal);
  return controller;
}

let queuedRequests = requestQueue();
let cooldown: { until: number; error: SafeApiError } | null = null;
const failures = new Map<string, { until: number; error: SafeApiError }>();

function checkCooldown() {
  if (!cooldown) return;
  if (Date.now() < cooldown.until) throw cooldown.error;
  cooldown = null;
}

function pauseRequests(ms: number, message: string): SafeApiError {
  // An older in-flight response must not shorten a quota cooldown established by another request.
  if (cooldown && cooldown.until >= Date.now() + ms) return cooldown.error;
  const error = new SafeApiError(message);
  cooldown = { until: Date.now() + ms, error };
  // Release requests waiting for a throttle slot: they should fail promptly, not keep queueing.
  queuedRequests.abort();
  queuedRequests = requestQueue();
  nextSlot = 0;
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

async function throttle(baseUrl: string) {
  checkCooldown();
  if (!isPublicSafeService(baseUrl)) return;
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + minIntervalMs();
  if (wait > 0) {
    try {
      await delay(wait, undefined, { signal: queuedRequests.signal });
    } catch {
      checkCooldown();
    }
  }
  checkCooldown();
}

export const quota = { limit: null as number | null, remaining: null as number | null };

async function getJson(path: string): Promise<unknown | null> {
  const generation = clientGeneration;
  const checkGeneration = () => {
    if (generation !== clientGeneration)
      throw new SafeApiError("Data source settings changed. Refresh to check signatures again.");
  };
  checkCooldown();
  const failure = failures.get(path);
  if (failure && Date.now() < failure.until) throw failure.error;
  failures.delete(path);
  const { safeTxServiceUrl } = await network();
  if (!safeTxServiceUrl) {
    throw new SafeApiError("No Safe Transaction Service for this chain. Set SAFE_TX_SERVICE_URL.");
  }

  await throttle(safeTxServiceUrl);
  checkGeneration();
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

  checkGeneration();
  const limit = response.headers.get("x-ratelimit-limit");
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (limit !== null && Number.isFinite(Number(limit))) quota.limit = Number(limit);
  if (remaining !== null && Number.isFinite(Number(remaining))) quota.remaining = Number(remaining);

  if (response.status === 404) return null;
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
  return response.json();
}

/** Newest messages of a Safe (governance actions are recent, so a few pages cover them). */
export function listSafeMessages(safe: Address): Promise<SafeMessages> {
  return cached(`safe:list:${safe.toLowerCase()}`, LIST_TTL_MS, async () => {
    const messages: SafeMessage[] = [];
    let total = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await getJson(
        `/api/v1/safes/${getAddress(safe)}/messages/?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&ordering=-created`
      );
      if (body === null) return { messages, complete: true };
      const parsed = listSchema.safeParse(body);
      if (!parsed.success) {
        throw new SafeApiError(`Unexpected Safe Transaction Service response for ${safe}`);
      }
      total = parsed.data.count;
      messages.push(...parsed.data.results);
      if (messages.length >= total || parsed.data.results.length < PAGE_SIZE) break;
    }
    return { messages, complete: messages.length >= total };
  });
}

/** Direct lookup by Safe message hash; null when Safe has no such message. */
export function getSafeMessage(messageHash: Hex): Promise<SafeMessage | null> {
  return cached(`safe:message:${messageHash.toLowerCase()}`, LIST_TTL_MS, async () => {
    const body = await getJson(`/api/v1/messages/${messageHash}/`);
    if (body === null) return null;
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      throw new SafeApiError(`Unexpected Safe Transaction Service response for ${messageHash}`);
    }
    return parsed.data;
  });
}

/** The message with exactly this hash, preferring the cached listing to save quota. */
export async function findSafeMessage(
  safe: Address,
  messageHash: Hex
): Promise<SafeMessage | null> {
  const listing = await listSafeMessages(safe);
  const hit = listing.messages.find(
    (m) => m.messageHash.toLowerCase() === messageHash.toLowerCase()
  );
  if (hit) return hit;
  return listing.complete ? null : getSafeMessage(messageHash);
}

let lastRefresh = 0;
/** Drops cached Safe answers (at most every 10 s, to protect the shared quota). */
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
  queuedRequests.abort();
  queuedRequests = requestQueue();
  cooldown = null;
  failures.clear();
  nextSlot = 0;
  lastRefresh = 0;
  quota.limit = null;
  quota.remaining = null;
}
