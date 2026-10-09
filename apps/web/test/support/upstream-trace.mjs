// Preload for benchmark-sync.ts (`node --import <this file>`): with UPSTREAM_TRACE_OUT set it
// records each upstream request in the window it was sent in (`inFlight` if not answered by its
// dump; what comes later is an `answer` record), and SIGUSR2 writes the window to
// `${UPSTREAM_TRACE_OUT}.<n>.json`. Recorded: times, HTTP status, a host hash, JSON-RPC methods,
// tags, selectors, spans, error codes, chain ids and heads, Safe request kinds and Safes. Never a
// URL, host, path, query, header, key, calldata or answer body.
import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const AGGREGATE3 = "0x82ad56cb";
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Any other string is recorded as "other", never copied.
const NAMED_TAGS = new Set(["latest", "finalized", "safe", "pending", "earliest"]);

export function hostId(host) {
  return createHash("sha256").update(String(host)).digest("hex").slice(0, 6);
}

function blockTag(value) {
  if (typeof value === "string") {
    if (!/^0x[0-9a-f]+$/i.test(value)) return NAMED_TAGS.has(value) ? value : "other";
    const n = Number(BigInt(value));
    return Number.isSafeInteger(n) ? n : "number";
  }
  if (value && typeof value === "object" && "blockHash" in value) return "hash";
  return value === undefined ? null : "other";
}

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

/** A request as recorded (without its timing), or null for one that stays on this machine. */
export function describeRequest(href, body) {
  const url = new URL(href);
  if (typeof body === "string" && body.includes('"jsonrpc"')) {
    const parsed = JSON.parse(body);
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    return {
      kind: "rpc",
      host: hostId(url.host),
      // ZKsync Era by its name: the app does not always ask it for its chain id.
      ...(/zksync|(^|\.)era\./i.test(url.hostname) ? { hint: "era" } : {}),
      calls: calls.map(describeCall),
    };
  }
  if (url.pathname.includes("/api/v1/") || url.hostname.endsWith("safe.global"))
    return { kind: "safe", ...safeRequest(url) };
  if (LOCAL.has(url.hostname)) return null;
  return { kind: "other" };
}

export function dumped(events) {
  return events.map((event) =>
    event.kind !== "head" && event.kind !== "answer" && event.ms === undefined
      ? { ...event, inFlight: true }
      : event
  );
}

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
  // The requests of the window being recorded.
  let current = new Set();
  let dumps = 0;
  // Each RPC host's chain id (from its eth_chainId answers), kept across dumps.
  const chains = {};
  const original = globalThis.fetch;

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
    if (Object.keys(errors).length > 0) answered(event, { errors });
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
        if (sent)
          res
            .clone()
            .json()
            .then(
              (answer) => readAnswers(event, sent, answer),
              () => {}
            );
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
    const file = `${out}.${dumps++}.json`;
    try {
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ dumpedAt: Date.now(), chains, events: dumped(events) }),
        { mode: 0o600 }
      );
      renameSync(`${file}.tmp`, file);
    } catch {
      // The benchmark reports the missing dump.
    }
    events = [];
    current = new Set();
  });
}

if (process.env.UPSTREAM_TRACE_OUT) install(process.env.UPSTREAM_TRACE_OUT);
