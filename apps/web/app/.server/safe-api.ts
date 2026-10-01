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
const minIntervalMs = env.SAFE_API_KEY ? 220 : 550;
let nextSlot = 0;
async function throttle(baseUrl: string) {
  if (new URL(baseUrl).hostname !== "api.safe.global") return;
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + minIntervalMs;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export const quota = { limit: null as number | null, remaining: null as number | null };

async function getJson(path: string): Promise<unknown | null> {
  const { safeTxServiceUrl } = await network();
  if (!safeTxServiceUrl) {
    throw new SafeApiError("No Safe Transaction Service for this chain. Set SAFE_TX_SERVICE_URL.");
  }

  for (let attempt = 0; ; attempt++) {
    await throttle(safeTxServiceUrl);
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
      throw new SafeApiError(`Safe Transaction Service unreachable: ${(error as Error).message}`);
    }

    const limit = response.headers.get("x-ratelimit-limit");
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (limit) quota.limit = Number(limit);
    if (remaining) quota.remaining = Number(remaining);

    if (response.status === 404) return null;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "2");
      log.warn({ path, retryAfter }, "Safe API rate limited");
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1_000));
      continue;
    }
    if (!response.ok) {
      throw new SafeApiError(
        response.status === 429
          ? "Safe Transaction Service rate limit reached. Keyless access allows 5,000 requests a month per IP; set SAFE_API_KEY or wait."
          : `Safe Transaction Service returned HTTP ${response.status} for ${path}`
      );
    }
    return response.json();
  }
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
