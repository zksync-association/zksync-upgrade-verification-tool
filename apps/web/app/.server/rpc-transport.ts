import { defaultLogger } from "@config/log.server";
import { HttpRequestError, type Transport, createTransport, http } from "viem";
import { concurrencyLimit } from "./cache";

export type LimitedHttpOptions = {
  /** Names the source in logs ("L1", "L2"); the URL is never logged. */
  label: string;
  /** Requests in flight at once, across all batches. */
  maxInFlight: number;
  /** Requests per JSON-RPC batch. Defaults to `maxInFlight`. */
  batchSize?: number;
  /**
   * false: one request per POST. viem batches JSON-RPC requests per URL across every transport,
   * so this is the only way to keep this transport's requests out of other transports' batches
   * (and their slow entries). Default true.
   */
  batch?: boolean;
  /**
   * Called as each JSON-RPC request is sent upstream (a retry counts again), with its method:
   * cost counting.
   */
  onRequest?: (method: string) => void;
  /**
   * Asked before a request is made: a promise to wait for first (the sync engine's credit pacer,
   * for the engine's own requests), or null to send it at once. A wait that rejects fails the
   * request unsent (the engine's work once it may no longer send, sync/pacer.ts).
   */
  pace?: (method: string) => Promise<void> | null;
  /** The in-flight limit to share with another transport (default: one of its own, maxInFlight). */
  limit?: ConcurrencyLimit;
};

export type ConcurrencyLimit = ReturnType<typeof concurrencyLimit>;

/** Batch read-only JSON-RPC traffic, with a per-client fallback for providers rejecting batches. */
export function limitedHttp(url: string, options: LimitedHttpOptions): Transport {
  const { label, maxInFlight, onRequest, pace } = options;
  const sent = (method: string) => {
    try {
      onRequest?.(method);
    } catch {
      // Counting never fails a request.
    }
  };
  const limit = options.limit ?? concurrencyLimit(maxInFlight);
  let acceptsBatch: boolean | undefined = options.batch === false ? false : undefined;
  const batchUnavailable = () => acceptsBatch === false;
  const httpOptions = { timeout: 10_000, retryCount: 0 };
  const single = http(url, httpOptions);
  const batch = http(url, {
    ...httpOptions,
    batch: { batchSize: options.batchSize ?? maxInFlight, wait: 5 },
    async onFetchResponse(response) {
      if (response.status === 400 || response.status === 413) {
        // A body over the provider's size cap (Infura: HTTP 400 "request body too large") says
        // nothing about batch support: only this call is retried as single requests.
        const text = await response
          .clone()
          .text()
          .catch(() => "");
        const code = errorCode(text);
        const tooLarge =
          code !== -32600 &&
          code !== -32601 &&
          (response.status === 413 || /too large/i.test(text));
        if (!tooLarge) acceptsBatch = false;
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
          let wait: Promise<void> | null = null;
          try {
            wait = pace?.(request.method) ?? null;
          } catch {
            // Pacing never fails a request.
          }
          if (wait) await wait;
          const queuedAt = performance.now();
          return limit(async () => {
            const startedAt = performance.now();
            let failed = false;
            try {
              sent(request.method);
              if (batchUnavailable()) return await singleTransport.request(request);
              try {
                return await batchTransport.request(request);
              } catch (error) {
                if (!batchUnavailable() && !tooLarge(error)) throw error;
                sent(request.method);
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
                    source: label,
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

/** The JSON-RPC error code of a batch-level reply, if it has one. */
function errorCode(text: string): number | undefined {
  try {
    const body = JSON.parse(text);
    const code = body?.error?.code ?? body?.code;
    return typeof code === "number" ? code : undefined;
  } catch {
    return undefined;
  }
}

function tooLarge(error: unknown) {
  return (
    error instanceof HttpRequestError &&
    (error.status === 413 || (error.status === 400 && /too large/i.test(error.details)))
  );
}
