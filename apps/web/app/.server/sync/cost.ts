// Upstream requests (L1 and Era JSON-RPC, Safe GETs), counted where they leave the process, as
// rolling one-hour counts in one-minute buckets (sync.engine.cost). A batch entry counts as one.

export type UpstreamKind = "l1" | "l2" | "safe";

const BUCKET_MS = 60_000;
const BUCKETS = 60;
const HOUR_MS = BUCKET_MS * BUCKETS;

type Bucket = { minute: number; l1: number; l2: number; safe: number; credits: number };

let buckets: Bucket[] = [];
let since = Date.now();

function bucketAt(now: number): Bucket {
  const minute = Math.floor(now / BUCKET_MS);
  const slot = ((minute % BUCKETS) + BUCKETS) % BUCKETS;
  let bucket = buckets[slot];
  if (!bucket || bucket.minute !== minute) {
    bucket = { minute, l1: 0, l2: 0, safe: 0, credits: 0 };
    buckets[slot] = bucket;
  }
  return bucket;
}

export function countUpstream(kind: UpstreamKind, n = 1, credits = 0) {
  if (!(n > 0)) return;
  const bucket = bucketAt(Date.now());
  bucket[kind] += n;
  if (credits > 0) bucket.credits += credits;
}

export type UpstreamCost = {
  rpcPerHour: number;
  l1RpcPerHour: number;
  l2RpcPerHour: number;
  safePerHour: number;
  /** An estimate at Infura's credit weights; other providers bill differently. */
  infuraCreditsPerHour: number;
  creditsBasis: "estimate: Infura credit weights (eth_getLogs 255, eth_chainId 5, others 80)";
  /** Less than an hour right after the process started. */
  windowMs: number;
};

export function upstreamCost(now = Date.now()): UpstreamCost {
  const current = Math.floor(now / BUCKET_MS);
  let l1 = 0;
  let l2 = 0;
  let safe = 0;
  let credits = 0;
  for (const bucket of buckets) {
    if (!bucket || bucket.minute > current || bucket.minute <= current - BUCKETS) continue;
    l1 += bucket.l1;
    l2 += bucket.l2;
    safe += bucket.safe;
    credits += bucket.credits;
  }
  return {
    rpcPerHour: l1 + l2,
    l1RpcPerHour: l1,
    l2RpcPerHour: l2,
    safePerHour: safe,
    infuraCreditsPerHour: credits,
    creditsBasis: "estimate: Infura credit weights (eth_getLogs 255, eth_chainId 5, others 80)",
    windowMs: Math.max(0, Math.min(HOUR_MS, now - since)),
  };
}

export function resetUpstreamCost(now = Date.now()) {
  buckets = [];
  since = now;
}
