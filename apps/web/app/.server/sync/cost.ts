// What the app asks upstream, counted where requests leave the process: every JSON-RPC request
// (an entry of a batch counts as one, a retry counts again) to the L1 and ZKsync Era RPCs, and every
// GET to the Safe Transaction Service, from requests and background work alike. Kept as rolling
// one-hour counts in one-minute buckets, for /api/status (sync.engine.cost). Nothing about a
// request is kept but its kind (and, for L1, the Infura credits its method costs).

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

/**
 * Counts `n` requests of one kind sent upstream now, and (L1) the Infura credits they cost
 * (sync/pacer.ts creditsOf). Never throws.
 */
export function countUpstream(kind: UpstreamKind, n = 1, credits = 0) {
  if (!(n > 0)) return;
  const bucket = bucketAt(Date.now());
  bucket[kind] += n;
  if (credits > 0) bucket.credits += credits;
}

export type UpstreamCost = {
  /** JSON-RPC requests to the L1 and ZKsync Era RPCs in the last hour (batch entries count one each). */
  rpcPerHour: number;
  l1RpcPerHour: number;
  l2RpcPerHour: number;
  /** Requests to the Safe Transaction Service in the last hour. */
  safePerHour: number;
  /**
   * An ESTIMATE of what the last hour's L1 requests cost on Infura: each request at Infura's
   * published credit weight (eth_getLogs 255, eth_chainId 5, every other method 80; batch entries
   * count one each). Other providers bill differently; see `creditsBasis`.
   */
  infuraCreditsPerHour: number;
  creditsBasis: "estimate: Infura credit weights (eth_getLogs 255, eth_chainId 5, others 80)";
  /** How much of the hour the counts cover: less than an hour right after the process started. */
  windowMs: number;
};

/** Requests sent upstream in the last hour (the current minute and the 59 before it). */
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

/** Starts counting afresh (tests). */
export function resetUpstreamCost(now = Date.now()) {
  buckets = [];
  since = now;
}
