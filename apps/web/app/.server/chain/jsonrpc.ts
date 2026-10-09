import { defaultLogger } from "@config/log.server";

// Raw JSON-RPC lanes. A lane is one upstream URL with its own queue, batch size and in-flight
// limit. Requests made within a short window go out together as one JSON-RPC batch; every entry
// keeps its own outcome. Lanes only ever send the read-only methods below, and nothing they throw
// or log contains the URL (RPC URLs often carry an API key in the path or query).

/** The only methods a lane sends. Each one reads chain state: nothing signs or sends. */
export const ALLOWED_METHODS = [
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "zks_getL1BatchBlockRange",
  "anvil_nodeInfo",
  "hardhat_metadata",
] as const;
export type AllowedMethod = (typeof ALLOWED_METHODS)[number];
const allowedMethods: ReadonlySet<string> = new Set(ALLOWED_METHODS);

export const MAX_BATCH = 50;

export type LaneErrorKind =
  | "method-not-allowed"
  | "timeout"
  | "network"
  | "http"
  | "rate-limited"
  | "bad-response"
  | "aborted";

/** The request never got a JSON-RPC answer: transport, HTTP, rate limit, or a closed lane. */
export class LaneError extends Error {
  override name = "LaneError";
  constructor(
    readonly kind: LaneErrorKind,
    readonly lane: string,
    readonly method: string,
    message: string,
    readonly status?: number
  ) {
    super(`${lane} ${method}: ${message}`);
  }
}

/** The node answered this request with a JSON-RPC error object. */
export class RpcError extends Error {
  override name = "RpcError";
  constructor(
    readonly code: number,
    message: string,
    readonly data: unknown,
    readonly lane: string,
    readonly method: string
  ) {
    super(message);
  }
}

export type LaneOptions = {
  url: string;
  /** Shown in errors and logs instead of the URL, e.g. "l1-history". */
  label: string;
  /** Largest JSON-RPC batch (capped at 50). */
  maxBatch: number;
  /** Largest number of concurrent POSTs. */
  maxInFlight: number;
  /** Micro-batching window. Requests made within it share a POST. */
  waitMs?: number;
  /** Per-POST timeout. */
  timeoutMs?: number;
  /** Retries after a timeout, network error, 5xx or a missing reply entry. */
  retries?: number;
  /** Base delay before a transient retry, and the rate-limit backoff without Retry-After. */
  backoffMs?: number;
  /** Retries of one request after rate limiting, before it fails. */
  rateLimitRetries?: number;
  fetch?: typeof fetch;
};

export type LaneStats = {
  label: string;
  /** Current batch size (adaptive). */
  batch: number;
  maxBatch: number;
  /** Batch cap learned from the provider (Era's "too many RPC calls in batch"). */
  batchCap: number;
  /** POSTs in flight now. */
  inFlight: number;
  /** Current in-flight limit (adaptive). */
  inFlightLimit: number;
  maxInFlight: number;
  peakInFlight: number;
  queued: number;
  requests: number;
  posts: number;
  errors: number;
  rateLimited: number;
  retries: number;
  /** undefined until the provider has answered a batch; false once the lane sends singles. */
  acceptsBatch: boolean | undefined;
  pausedMs: number;
};

export interface Lane {
  readonly label: string;
  request<T = unknown>(method: AllowedMethod, params?: readonly unknown[]): Promise<T>;
  stats(): LaneStats;
  /** Fails queued and in-flight requests with an "aborted" LaneError; later requests fail too. */
  close(): void;
}

type Entry = {
  id: number;
  method: string;
  json: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  transient: number;
  limited: number;
  // After a "request body too large" reply, the largest POST this entry may be part of.
  maxGroup: number;
};

type Exchange =
  | { failure: "timeout" | "network" | "aborted" }
  | { failure?: undefined; status: number; headers: Headers; text: string };

type ErrorObject = { code: number; message: string; data?: unknown };

const RECOVER_AFTER = 10; // clean POSTs before one step of recovery
const CEILING_MS = 60_000; // how long a batch size that was rate limited is not retried
const MAX_PAUSE_MS = 15_000; // longest pause after one rate-limited reply
const MAX_BACKOFF_MS = 4_000;
const SLOW_POST_MS = 5_000;

let nextId = 1;

export function createLane(options: LaneOptions): Lane {
  const { url, label } = options;
  const maxBatch = Math.max(1, Math.min(MAX_BATCH, Math.floor(options.maxBatch)));
  const maxInFlight = Math.max(1, Math.floor(options.maxInFlight));
  const waitMs = options.waitMs ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 250;
  const rateLimitRetries = options.rateLimitRetries ?? 6;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const scrub = scrubber(secretsOf(url));

  const queue: Entry[] = [];
  const controllers = new Set<AbortController>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = 0;
  let closed = false;

  let batch = maxBatch;
  let batchCap = maxBatch;
  let inFlightLimit = maxInFlight;
  let acceptsBatch: boolean | undefined;
  let largestOk = 0;
  // Largest batch accepted since the batch size last shrank.
  let goodSinceShrink = 0;
  let ceiling = { size: Number.POSITIVE_INFINITY, until: 0 };
  let clean = 0;
  let epoch = 0;
  let limitedStreak = 0;
  let pausedUntil = 0;

  let active = 0;
  let peakInFlight = 0;
  let requests = 0;
  let posts = 0;
  let errors = 0;
  let rateLimited = 0;
  let retried = 0;

  const fail = (entry: Entry, error: Error) => {
    errors++;
    entry.reject(error);
  };
  const laneError = (entry: Entry, kind: LaneErrorKind, message: string, status?: number) =>
    new LaneError(kind, label, entry.method, scrub.text(message), status);
  // The whole body is scrubbed before it is cut to length.
  const httpError = (entry: Entry, status: number, body: string) =>
    laneError(entry, "http", httpMessage(status, scrub.text(body)), status);
  const aborted = (entry: Entry) => laneError(entry, "aborted", "the data source was reset");

  function schedule(delayMs: number) {
    if (closed) return;
    const at = Date.now() + delayMs;
    if (timer !== undefined && timerAt <= at) return;
    if (timer !== undefined) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => {
      timer = undefined;
      pump();
    }, delayMs);
  }

  function pump() {
    if (closed) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) {
      if (queue.length > 0) schedule(wait);
      return;
    }
    while (active < inFlightLimit && queue.length > 0) {
      const group = take();
      if (group.length === 0) break;
      void post(group);
    }
  }

  function take(): Entry[] {
    let limit = acceptsBatch === false ? 1 : Math.min(batch, batchCap);
    const group: Entry[] = [];
    while (group.length < limit) {
      const next = queue[0];
      if (!next || next.maxGroup <= group.length) break;
      limit = Math.min(limit, next.maxGroup);
      group.push(next);
      queue.shift();
    }
    return group;
  }

  function requeue(entries: Entry[], delayMs = 0) {
    const put = () => {
      if (closed) {
        for (const entry of entries) fail(entry, aborted(entry));
        return;
      }
      queue.unshift(...entries);
      pump();
    };
    if (delayMs > 0) setTimeout(put, delayMs);
    else put();
  }

  async function exchange(body: string): Promise<Exchange> {
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    } catch {
      // The fetch error is dropped on purpose: its message or cause can name the host.
      if (closed) return { failure: "aborted" };
      return { failure: timedOut ? "timeout" : "network" };
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  async function post(group: Entry[]) {
    if (group.length === 0) return;
    active++;
    posts++;
    peakInFlight = Math.max(peakInFlight, active);
    const sentEpoch = epoch;
    const asBatch = group.length > 1;
    const startedAt = Date.now();
    const result = await exchange(
      asBatch ? `[${group.map((e) => e.json).join(",")}]` : (group[0] as Entry).json
    );
    active--;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= SLOW_POST_MS)
      defaultLogger.warn(
        { lane: label, methods: summarize(group), elapsedMs, outcome: outcomeOf(result) },
        "Slow RPC request"
      );
    try {
      handle(group, asBatch, sentEpoch, result);
    } catch (error) {
      // Never leave a caller hanging on a bug in the reply handling.
      for (const entry of group)
        fail(entry, laneError(entry, "bad-response", errorMessage(error), undefined));
    }
    pump();
  }

  function handle(group: Entry[], asBatch: boolean, sentEpoch: number, result: Exchange) {
    if (result.failure === "aborted") {
      for (const entry of group) fail(entry, aborted(entry));
      return;
    }
    if (result.failure) {
      transient(group, result.failure, result.failure === "timeout" ? "timed out" : "fetch failed");
      return;
    }
    const { status, headers, text } = result;
    const json = parseJson(text);
    const top = Array.isArray(json) ? undefined : topErrorOf(json);

    if (status === 429 || (top && isRateLimit(top))) {
      limit(group, group.length, sentEpoch, retryAfterMs(headers));
      return;
    }
    if (status >= 500 || status === 408) {
      transient(group, "http", `HTTP ${status}`, status);
      return;
    }
    const ok = status >= 200 && status < 300;
    const tooLarge = status === 413 || (status === 400 && /too large/i.test(text));

    if (asBatch && !Array.isArray(json)) {
      if (top?.code === -32014) return capBatch(group);
      if (tooLarge) return split(group);
      if (top?.code === -32600 || top?.code === -32601) return toSingles(group);
      if (ok || status === 400) {
        // A provider that has never answered a batch is taken not to support them. One that has
        // had a bad moment (an internal error, a proxy's page): retry, and keep batching.
        if (acceptsBatch === undefined) return toSingles(group);
        if (ok) return transient(group, "bad-response", "unexpected reply to a batch");
        return isolate(group);
      }
      for (const entry of group) fail(entry, httpError(entry, status, text));
      return;
    }

    if (!asBatch) {
      const entry = group[0] as Entry;
      if (tooLarge) {
        fail(entry, httpError(entry, status, text));
        return;
      }
      const reply = Array.isArray(json) ? json.find((r) => idOf(r) === entry.id) : json;
      if (!answers(reply, entry.id)) {
        if (ok) transient(group, "bad-response", "unexpected reply");
        else fail(entry, httpError(entry, status, text));
        return;
      }
      settle(group, [reply], sentEpoch, headers);
      return;
    }

    acceptsBatch = true;
    settle(group, json as unknown[], sentEpoch, headers);
  }

  function settle(group: Entry[], replies: unknown[], sentEpoch: number, headers: Headers) {
    const byId = new Map<unknown, Record<string, unknown>>();
    for (const reply of replies) if (isReply(reply)) byId.set(idOf(reply), reply);
    const missing: Entry[] = [];
    const limited: Entry[] = [];
    for (const entry of group) {
      // A null id can only answer a lone request, and only with an error.
      const orphan = group.length === 1 ? byId.get(null) : undefined;
      const reply = byId.get(entry.id) ?? (answers(orphan, entry.id) ? orphan : undefined);
      if (!reply) {
        missing.push(entry);
        continue;
      }
      const error = errorOf(reply);
      if (error) {
        if (isRateLimit(error)) limited.push(entry);
        else
          fail(
            entry,
            new RpcError(
              error.code,
              scrub.text(error.message),
              scrub.data(error.data),
              label,
              entry.method
            )
          );
      } else if ("result" in reply) {
        entry.resolve(reply.result);
      } else {
        missing.push(entry);
      }
    }
    if (limited.length > 0) limit(limited, group.length, sentEpoch, retryAfterMs(headers));
    if (missing.length > 0) transient(missing, "bad-response", "no reply for this request");
    if (limited.length === 0 && missing.length === 0) recover(group.length);
  }

  function transient(entries: Entry[], kind: LaneErrorKind, message: string, status?: number) {
    clean = 0;
    const again: Entry[] = [];
    let attempt = 0;
    for (const entry of entries) {
      if (entry.transient < retries) {
        entry.transient++;
        attempt = Math.max(attempt, entry.transient);
        again.push(entry);
      } else {
        fail(entry, laneError(entry, kind, message, status));
      }
    }
    if (again.length === 0) return;
    retried += again.length;
    requeue(again, backoffMs * 2 ** (attempt - 1));
  }

  function limit(entries: Entry[], sentSize: number, sentEpoch: number, retryAfter?: number) {
    rateLimited++;
    clean = 0;
    const now = Date.now();
    // Concurrent POSTs sent with the same settings shrink the lane (and lengthen the backoff)
    // once, not once each.
    if (sentEpoch === epoch) {
      epoch++;
      limitedStreak++;
      const size = acceptsBatch === false ? 1 : Math.min(batch, batchCap);
      if (sentSize > 1 && sentSize >= size && goodSinceShrink < sentSize) {
        // A full POST larger than anything that worked since the last shrink: the size is the
        // likely cause. Halve, but never below a smaller size that worked, so a recovery probe
        // that fails goes back one step (Tenderly: 25 -> 12 -> 6, a probe at 7 -> 6), and do not
        // try the refused size again for a while.
        batch = Math.max(1, Math.floor(size / 2), Math.min(goodSinceShrink, size));
        ceiling = {
          size: Math.min(ceiling.until > now ? ceiling.size : Number.POSITIVE_INFINITY, sentSize),
          until: now + CEILING_MS,
        };
        goodSinceShrink = 0;
      } else if (size > 1) {
        // A short POST, or a size that has worked: the rate is the cause. Fewer requests per POST
        // first; the ceiling stays, so recovery can climb back to the full batch.
        batch = Math.max(1, Math.floor(size / 2));
        goodSinceShrink = 0;
      } else {
        // Then fewer POSTs at once.
        inFlightLimit = Math.max(1, Math.floor(inFlightLimit / 2));
      }
      defaultLogger.warn(
        { lane: label, sent: sentSize, batch, inFlight: inFlightLimit, retryAfterMs: retryAfter },
        "RPC rate limited; sending smaller batches"
      );
    }
    const pause = Math.min(
      MAX_PAUSE_MS,
      retryAfter ?? Math.min(MAX_BACKOFF_MS, backoffMs * 2 ** Math.max(0, limitedStreak - 1))
    );
    pausedUntil = Math.max(pausedUntil, now + pause);
    const again: Entry[] = [];
    for (const entry of entries) {
      if (entry.limited < rateLimitRetries) {
        entry.limited++;
        again.push(entry);
      } else {
        fail(entry, laneError(entry, "rate-limited", "the RPC is rate limiting requests", 429));
      }
    }
    retried += again.length;
    if (again.length > 0) requeue(again);
  }

  function recover(sentSize: number) {
    limitedStreak = 0;
    goodSinceShrink = Math.max(goodSinceShrink, sentSize);
    if (sentSize > 1) largestOk = Math.max(largestOk, sentSize);
    if (++clean < RECOVER_AFTER) return;
    clean = 0;
    if (inFlightLimit < maxInFlight) {
      inFlightLimit++;
      return;
    }
    const limitTo = Math.min(
      batchCap,
      ceiling.until > Date.now() ? ceiling.size - 1 : Number.POSITIVE_INFINITY
    );
    if (batch < limitTo) batch++;
  }

  function capBatch(group: Entry[]) {
    const size = group.length;
    batchCap = Math.min(
      batchCap,
      largestOk > 0 && largestOk < size ? largestOk : Math.max(1, Math.floor(size / 2))
    );
    batch = Math.min(batch, batchCap);
    defaultLogger.warn({ lane: label, sent: size, batchCap }, "RPC caps batch size");
    requeue(group);
  }

  function split(group: Entry[]) {
    const half = Math.ceil(group.length / 2);
    for (const entry of group) entry.maxGroup = Math.min(entry.maxGroup, half);
    requeue(group);
  }

  /** Sends these entries one by one (each gets its own answer); the lane keeps batching. */
  function isolate(group: Entry[]) {
    for (const entry of group) entry.maxGroup = 1;
    requeue(group);
  }

  function toSingles(group: Entry[]) {
    if (acceptsBatch !== false)
      defaultLogger.warn({ lane: label }, "RPC rejects batches; sending single requests");
    acceptsBatch = false;
    requeue(group);
  }

  return {
    label,
    request<T = unknown>(method: AllowedMethod, params: readonly unknown[] = []): Promise<T> {
      if (!allowedMethods.has(method))
        return Promise.reject(
          new LaneError(
            "method-not-allowed",
            label,
            String(method),
            "not a read-only method this app sends"
          )
        );
      if (closed)
        return Promise.reject(new LaneError("aborted", label, method, "the data source was reset"));
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        let json: string;
        try {
          json = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          reject(error);
          return;
        }
        requests++;
        queue.push({
          id,
          method,
          json,
          resolve: resolve as (value: unknown) => void,
          reject,
          transient: 0,
          limited: 0,
          maxGroup: Number.POSITIVE_INFINITY,
        });
        if (queue.length >= Math.min(batch, batchCap) && active < inFlightLimit) pump();
        else schedule(waitMs);
      });
    },
    stats: () => ({
      label,
      batch: acceptsBatch === false ? 1 : Math.min(batch, batchCap),
      maxBatch,
      batchCap,
      inFlight: active,
      inFlightLimit,
      maxInFlight,
      peakInFlight,
      queued: queue.length,
      requests,
      posts,
      errors,
      rateLimited,
      retries: retried,
      acceptsBatch,
      pausedMs: Math.max(0, pausedUntil - Date.now()),
    }),
    close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const entry of queue.splice(0)) fail(entry, aborted(entry));
      for (const controller of controllers) controller.abort();
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isReply(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(reply: unknown): unknown {
  if (!isReply(reply)) return undefined;
  const id = reply.id ?? null;
  // Some proxies echo numeric ids as strings.
  return typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
}

function toErrorObject(source: Record<string, unknown>): ErrorObject | undefined {
  if (typeof source.code !== "number") return undefined;
  return {
    code: source.code,
    message: typeof source.message === "string" ? source.message : "",
    data: source.data,
  };
}

/** A reply's JSON-RPC error object, `{error: {code, message, data?}}`. */
function errorOf(value: unknown): ErrorObject | undefined {
  return isReply(value) && isReply(value.error) ? toErrorObject(value.error) : undefined;
}

/** An error about the whole POST: a JSON-RPC error, or a bare `{code, message}` (Tenderly's 429). */
function topErrorOf(value: unknown): ErrorObject | undefined {
  if (!isReply(value)) return undefined;
  return errorOf(value) ?? ("result" in value ? undefined : toErrorObject(value));
}

/**
 * The reply answers request `id`: it carries that id, or it is an error with a null id (JSON-RPC's
 * answer when the request could not be read). A result under any other id answers nothing.
 */
function answers(reply: unknown, id: number): reply is Record<string, unknown> {
  if (!isReply(reply)) return false;
  const replyId = idOf(reply);
  return replyId === id || (replyId === null && errorOf(reply) !== undefined);
}

// How nodes answer an eth_getLogs query that is too big. Infura: "query returned more than 10000
// results. Try with this block range [...]"; others name a block range, a response size or a cap.
const RANGE_ANSWER =
  /block range|\brange\b.*\b(?:exceed|limit|too (?:large|wide|big))|exceed\w*\b.*\brange\b|more than [\d,]+ (?:results|logs)|max(?:imum)? (?:results|logs)|too many (?:results|logs)|response size|query timeout|query (?:returned|exceeds)/i;

/**
 * A provider rate limit, as opposed to an answer. -32005 is also how some nodes answer an
 * eth_getLogs query that is too big; that is an answer about the range, for the caller to handle,
 * not a reason to back off. Every other -32005 ("Too many requests for eth_getLogs", "Request rate
 * exceeded. Blocked for 10 seconds") is a rate limit.
 */
function isRateLimit({ code, message }: ErrorObject) {
  if (code === 429) return true;
  return code === -32005 && !RANGE_ANSWER.test(message);
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** `text` must already be scrubbed: cutting first could leave half a secret that no longer matches. */
function httpMessage(status: number, scrubbedText: string) {
  const detail = scrubbedText.replace(/\s+/g, " ").trim().slice(0, 200).trimEnd();
  return detail ? `HTTP ${status} (${detail})` : `HTTP ${status}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function summarize(group: Entry[]) {
  const counts = new Map<string, number>();
  for (const entry of group) counts.set(entry.method, (counts.get(entry.method) ?? 0) + 1);
  return [...counts].map(([method, n]) => (n > 1 ? `${method}x${n}` : method)).join(",");
}

function outcomeOf(result: Exchange) {
  return result.failure ?? `HTTP ${result.status}`;
}

// Path segments that name an API version, a protocol or a network rather than an account.
const PUBLIC_SEGMENT =
  /^(?:v\d+(?:\.\d+)*|api|rpc|jsonrpc|json-rpc|http|https|ws|wss|eth|evm|ethereum|mainnet|sepolia|holesky|hoodi|goerli|zksync|era|public|node|nodes)$/i;
// Secrets at least this long are also removed from 0x-hex data. Shorter ones would match revert
// bytes by chance and corrupt them; a hex string cannot hold a host or a URL.
const HEX_SECRET_MIN = 16;
const HEX = /^0x[0-9a-f]*$/i;
const ANY_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi;
const MAX_DATA_DEPTH = 16;

/** Every part of an RPC URL that could identify the account or carry a key, longest first. */
export function secretsOf(url: string): string[] {
  const parts = new Set<string>([url, url.replace(/\/+$/, "")]);
  try {
    const parsed = new URL(url);
    parts.add(parsed.href);
    parts.add(parsed.origin);
    parts.add(parsed.host);
    parts.add(parsed.hostname);
    for (const credential of [parsed.username, parsed.password]) {
      parts.add(credential);
      parts.add(safeDecode(credential));
    }
    // Keys and app ids sit in path segments (Infura's /v3/<key>, /v1/<app id>) or query values.
    for (const segment of parsed.pathname.split("/")) {
      const decoded = safeDecode(segment);
      if (PUBLIC_SEGMENT.test(decoded)) continue;
      parts.add(segment);
      parts.add(decoded);
    }
    if (parsed.search.length > 1) parts.add(parsed.search.slice(1));
    for (const [, value] of parsed.searchParams) parts.add(value);
    if (parsed.hash.length > 1) parts.add(parsed.hash.slice(1));
  } catch {
    // Not a URL: the literal string is still scrubbed.
  }
  return [...parts].filter((part) => part.length >= 4).sort((a, b) => b.length - a.length);
}

export type Scrubber = { text(text: string): string; data(data: unknown): unknown };

/**
 * Removes `secrets` (case-insensitively: hosts are) and any URL from text, and from error data.
 * In data, strings that are pure 0x-hex (revert bytes) only lose long secrets, so they stay hex.
 */
export function scrubber(secrets: readonly string[]): Scrubber {
  const pattern = (parts: readonly string[]) =>
    parts.length > 0
      ? new RegExp(
          [...parts]
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join("|"),
          "gi"
        )
      : undefined;
  const all = pattern(secrets);
  const long = pattern(secrets.filter((secret) => secret.length >= HEX_SECRET_MIN));
  // Whole URLs first: redacting a configured host or origin inside a longer URL first would cut it
  // short of ANY_URL and leave the rest of its path (a key) behind.
  const text = (value: string) => {
    const withoutUrls = value.replace(ANY_URL, "[url]");
    return all ? withoutUrls.replace(all, "[redacted]") : withoutUrls;
  };
  const data = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") {
      if (!HEX.test(value)) return text(value);
      return long ? value.replace(long, "[redacted]") : value;
    }
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_DATA_DEPTH) return "[redacted]";
    if (Array.isArray(value)) return value.map((item) => data(item, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [text(key), data(item, depth + 1)])
    );
  };
  return { text, data: (value) => data(value) };
}

export function scrubText(text: string, secrets: readonly string[]): string {
  return scrubber(secrets).text(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
