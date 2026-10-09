import { type Transport, createTransport, http } from "viem";
import { concurrencyLimit } from "./cache";
import { defaultLogger } from "@config/log.server";

/** Batch read-only JSON-RPC traffic, with a per-client fallback for providers rejecting batches. */
export function limitedHttp(url: string, maxInFlight: number): Transport {
  const limit = concurrencyLimit(maxInFlight);
  let acceptsBatch: boolean | undefined;
  const batchUnavailable = () => acceptsBatch === false;
  const options = { timeout: 10_000, retryCount: 0 };
  const single = http(url, options);
  const batch = http(url, {
    ...options,
    batch: { batchSize: maxInFlight, wait: 5 },
    async onFetchResponse(response) {
      if (response.status === 400 || response.status === 413) {
        acceptsBatch = false;
      } else if (acceptsBatch === undefined && response.ok) {
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (Array.isArray(body)) acceptsBatch = true;
        else if (body?.error?.code === -32600 || body?.error?.code === -32601) acceptsBatch = false;
      }
    },
  });
  return (args) => {
    const singleTransport = single(args);
    const batchTransport = batch(args);
    return createTransport(
      {
        key: "bounded-http",
        name: "Batched read-only JSON-RPC",
        type: "http",
        retryCount: 2,
        retryDelay: 500,
        request: (async (request) => {
          const queuedAt = performance.now();
          return limit(async () => {
            const startedAt = performance.now();
            let failed = false;
            try {
              if (batchUnavailable()) return await singleTransport.request(request);
              try {
                return await batchTransport.request(request);
              } catch (error) {
                if (!batchUnavailable()) throw error;
                return await singleTransport.request(request);
              }
            } catch (error) {
              failed = true;
              throw error;
            } finally {
              const elapsedMs = Math.round(performance.now() - queuedAt);
              if (elapsedMs >= 1000)
                defaultLogger.warn(
                  {
                    source: maxInFlight === 8 ? "L1" : "L2",
                    method: request.method,
                    queueMs: Math.round(startedAt - queuedAt),
                    elapsedMs,
                    failed,
                  },
                  "Slow RPC read"
                );
            }
          });
        }) as typeof singleTransport.request,
      },
      { url }
    );
  };
}
