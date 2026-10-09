// Preload for the read-only benchmark (benchmark-sync.ts): `node --import <this file>
// ./server-build/index.js` with UPSTREAM_TRACE_OUT set records every request the server sends
// upstream, and SIGUSR2 writes what was recorded since the last signal to
// `${UPSTREAM_TRACE_OUT}.<n>.json` (n = 0, 1, …) and starts afresh.
//
// Each request is recorded when it is sent, in the dump of the window it went out in, answered
// or not: its timing and status are filled in when the answer comes, and one still unanswered
// when its window is dumped says so (`inFlight`). An answer (or a failure, or the error codes of
// its entries) that comes after its request's window was dumped is recorded in the window it came
// in, as an `answer` record (never counted as a request), so an error or a rate limit on a request
// that straddled a dump is never lost. What is recorded, per request: when it was sent and
// answered, its HTTP status, and
//   - JSON-RPC: a short hash of the host (to tell the L1 and ZKsync Era RPCs apart, never the host
//     itself), each entry's method, block tag, the 4-byte selector of eth_call data (or the number
//     of sub-calls of a Multicall3 aggregate3), the block span of eth_getLogs, and the error codes
//     of the entries that failed; the chain id and head numbers the RPC answered;
//   - Safe Transaction Service: what was asked (a change check, a listing page, a message, a Safe's
//     info) and of which Safe (public addresses).
// Never a URL, host, path, query string, header, key, calldata or answer body beyond the above.
// Without UPSTREAM_TRACE_OUT it does nothing.
import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const AGGREGATE3 = "0x82ad56cb";
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A short hash of a host: tells two RPCs apart in a trace without naming either. */
export function hostId(host) {
  return createHash("sha256").update(String(host)).digest("hex").slice(0, 6);
}

function blockTag(value) {
  if (typeof value === "string") {
    if (!/^0x[0-9a-f]+$/i.test(value)) return value;
    const n = Number(BigInt(value));
    return Number.isSafeInteger(n) ? n : "number";
  }
  if (value && typeof value === "object" && "blockHash" in value) return "hash";
  return value === undefined ? null : "other";
}

/** One JSON-RPC entry as recorded: method, block tag, selector or aggregate3 size, log span. */
export function describeCall(call) {
  const method = typeof call?.method === "string" ? call.method : "?";
  const out = { m: method };
  const params = Array.isArray(call?.params) ? call.params : [];
  try {
    if (method === "eth_call") {
      const tx = params[0] ?? {};
      const data = String(tx.data ?? tx.input ?? "");
      const to = String(tx.to ?? "").toLowerCase();
      if (to === MULTICALL3 && data.startsWith(AGGREGATE3)) {
        // aggregate3((address,bool,bytes)[]): the array's length is the second word.
        const n = Number.parseInt(data.slice(10 + 64, 10 + 128), 16);
        out.mc = Number.isFinite(n) ? n : 0;
      } else {
        out.sel = /^0x[0-9a-f]{8}/i.test(data) ? data.slice(0, 10).toLowerCase() : "none";
      }
      out.tag = blockTag(params[1]);
    } else if (method === "eth_getCode" || method === "eth_getBalance") {
      out.tag = blockTag(params[1]);
    } else if (method === "eth_getBlockByNumber") {
      out.tag = blockTag(params[0]);
    } else if (method === "eth_getLogs") {
      const filter = params[0] ?? {};
      if (filter.blockHash) out.tag = "hash";
      else {
        const from = blockTag(filter.fromBlock);
        const to = blockTag(filter.toBlock);
        if (typeof from === "number" && typeof to === "number") out.span = to - from + 1;
        else out.tag = `${from ?? "earliest"}..${to ?? "latest"}`;
      }
    }
  } catch {
    // Recorded with what is known.
  }
  return out;
}

/** What a Safe Transaction Service request asks for, from its path and query (never kept). */
export function safeRequest(url) {
  const path = url.pathname;
  const safe = (path.match(/\/safes\/(0x[0-9a-fA-F]{40})/) ?? [])[1]?.toLowerCase() ?? null;
  const ordering = url.searchParams.get("ordering");
  let what = "other";
  if (/\/safes\/0x[0-9a-fA-F]{40}\/messages\/?$/.test(path))
    what = ordering === "-modified" ? "check" : "listing";
  else if (/\/messages\/0x[0-9a-fA-F]{64}\/?$/.test(path)) what = "message";
  else if (/\/safes\/0x[0-9a-fA-F]{40}\/?$/.test(path)) what = "info";
  return { what, safe };
}

/**
 * A request as recorded (without its timing), or null for one that stays on this machine. JSON-RPC
 * is told by its body; the Safe Transaction Service by its API path (or Safe's own host).
 */
export function describeRequest(href, body) {
  const url = new URL(href);
  if (typeof body === "string" && body.includes('"jsonrpc"')) {
    const parsed = JSON.parse(body);
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    return {
      kind: "rpc",
      host: hostId(url.host),
      // A ZKsync Era RPC by its name (the app does not always ask it for its chain id).
      ...(/zksync|(^|\.)era\./i.test(url.hostname) ? { hint: "era" } : {}),
      calls: calls.map(describeCall),
    };
  }
  if (url.pathname.includes("/api/v1/") || url.hostname.endsWith("safe.global"))
    return { kind: "safe", ...safeRequest(url) };
  if (LOCAL.has(url.hostname)) return null;
  return { kind: "other" };
}

/** A window's events as dumped: a request not answered yet is marked `inFlight`. */
export function dumped(events) {
  return events.map((event) =>
    event.kind !== "head" && event.kind !== "answer" && event.ms === undefined
      ? { ...event, inFlight: true }
      : event
  );
}

/**
 * What came for a request after its window was dumped (`fields`: its timing, HTTP status or
 * failure, its entries' error codes), for the window it came in: which kind of request it was,
 * when it was sent, and (JSON-RPC) its host's short hash.
 */
export function answerRecord(event, fields, at = Date.now()) {
  return {
    kind: "answer",
    at,
    of: event.kind,
    sentAt: event.at,
    ...(event.host ? { host: event.host } : {}),
    ...fields,
  };
}

function install(out) {
  let events = [];
  // The requests of the window being recorded (the next dump's).
  let current = new Set();
  let dumps = 0;
  // Which chain each RPC host serves (from its eth_chainId answers): kept across dumps.
  const chains = {};
  const original = globalThis.fetch;

  // What came for `event`: on the request while its window is being recorded, else (its window
  // was dumped) as an answer record in the window it came in.
  const answered = (event, fields) => {
    if (current.has(event)) Object.assign(event, fields);
    else events.push(answerRecord(event, fields));
  };

  // The answers of one JSON-RPC POST: failed entries' codes, the chain id, and the head numbers.
  const readAnswers = (event, sent, answer) => {
    const answers = Array.isArray(answer) ? answer : [answer];
    const byId = new Map(sent.map((call) => [call?.id, call]));
    const errors = {};
    for (const reply of answers) {
      if (!reply || typeof reply !== "object") continue;
      const call = byId.get(reply.id) ?? (sent.length === 1 ? sent[0] : null);
      if (reply.error) {
        const code = String(reply.error.code ?? "?");
        errors[code] = (errors[code] ?? 0) + 1;
        continue;
      }
      if (!call) continue;
      if (call.method === "eth_chainId" && typeof reply.result === "string")
        chains[event.host] = Number(BigInt(reply.result));
      const head =
        call.method === "eth_blockNumber"
          ? reply.result
          : call.method === "eth_getBlockByNumber" && call.params?.[0] === "latest"
            ? reply.result?.number
            : null;
      if (typeof head === "string")
        events.push({
          kind: "head",
          at: Date.now(),
          host: event.host,
          number: Number(BigInt(head)),
        });
    }
    if (Object.keys(errors).length > 0)
      answered(event, { errors: current.has(event) ? mergeCounts(event.errors, errors) : errors });
  };

  globalThis.fetch = async (input, init) => {
    let event = null;
    let sent = null;
    const t0 = performance.now();
    try {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = init?.body;
      const described = describeRequest(href, body);
      if (described) {
        const recorded = { at: Date.now(), ...described };
        if (described.kind === "rpc") {
          const parsed = JSON.parse(body);
          sent = Array.isArray(parsed) ? parsed : [parsed];
        }
        // Counted in the window it is sent in, whenever (and whether) it is answered.
        events.push(recorded);
        current.add(recorded);
        event = recorded;
      }
    } catch {
      // Not recorded; sent as it is.
    }
    try {
      const res = await original(input, init);
      if (event) {
        answered(event, { ms: Math.round(performance.now() - t0), status: res.status });
        if (sent) {
          const recorded = event;
          const calls = sent;
          res
            .clone()
            .json()
            .then(
              (answer) => readAnswers(recorded, calls, answer),
              () => {}
            );
        }
      }
      return res;
    } catch (error) {
      if (event)
        answered(event, {
          ms: Math.round(performance.now() - t0),
          failed: error instanceof Error ? error.name : "Error",
        });
      throw error;
    }
  };

  process.on("SIGUSR2", () => {
    const n = dumps++;
    const file = `${out}.${n}.json`;
    try {
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ dumpedAt: Date.now(), chains, events: dumped(events) }),
        {
          mode: 0o600,
        }
      );
      renameSync(`${file}.tmp`, file);
    } catch {
      // The benchmark reports the missing dump.
    }
    events = [];
    current = new Set();
  });
}

/** Two counts by key, added. */
function mergeCounts(a = {}, b = {}) {
  const sum = { ...a };
  for (const [key, n] of Object.entries(b)) sum[key] = (sum[key] ?? 0) + n;
  return sum;
}

if (process.env.UPSTREAM_TRACE_OUT) install(process.env.UPSTREAM_TRACE_OUT);
