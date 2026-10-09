// A JSON-RPC upstream as a `fetch` stub, for lane and index tests. It records every POST, tracks
// how many are in flight, and lets a test answer per entry or take over a whole POST (rate limits,
// batch rejections, oversized bodies). Nothing here touches the network.

export type FakeCall = { id: unknown; method: string; params: unknown[] };

export type FakePost = {
  /** The POST body was a JSON array. */
  batch: boolean;
  calls: FakeCall[];
  startedAt: number;
  /** POSTs in flight when this one arrived, itself included. */
  concurrent: number;
};

/** Returned by a handler to answer one entry with a JSON-RPC error. */
export class FakeRpcError {
  constructor(
    readonly code: number,
    readonly message: string,
    readonly data?: unknown
  ) {}
}

export type FakeOptions = {
  /** Answers one entry: return the result, or a FakeRpcError. Defaults to "0x1". */
  handle?: (call: FakeCall, post: FakePost) => unknown | Promise<unknown>;
  /** Takes over a whole POST when it returns a Response. */
  intercept?: (post: FakePost) => Response | undefined | Promise<Response | undefined>;
  /** Delay before answering (default 0). */
  delayMs?: number | ((post: FakePost) => number);
  /** Answer batch entries in reverse order. */
  reverse?: boolean;
};

export function fakeJsonRpc(options: FakeOptions = {}) {
  const posts: FakePost[] = [];
  let active = 0;
  let peak = 0;

  const fetch = async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const text = String(init?.body ?? "");
    const parsed = JSON.parse(text) as FakeCall | FakeCall[];
    const post: FakePost = {
      batch: Array.isArray(parsed),
      calls: Array.isArray(parsed) ? parsed : [parsed],
      startedAt: Date.now(),
      concurrent: 0,
    };
    posts.push(post);
    active++;
    peak = Math.max(peak, active);
    post.concurrent = active;
    try {
      const delay =
        typeof options.delayMs === "function" ? options.delayMs(post) : options.delayMs ?? 0;
      if (delay > 0) await sleep(delay, init?.signal ?? undefined);
      const taken = await options.intercept?.(post);
      if (taken) return taken;
      const replies = await Promise.all(
        post.calls.map(async (call) => {
          const value = await (options.handle?.(call, post) ?? "0x1");
          return value instanceof FakeRpcError
            ? {
                jsonrpc: "2.0",
                id: call.id,
                error: {
                  code: value.code,
                  message: value.message,
                  ...(value.data === undefined ? {} : { data: value.data }),
                },
              }
            : { jsonrpc: "2.0", id: call.id, result: value };
        })
      );
      if (!post.batch) return Response.json(replies[0]);
      return Response.json(options.reverse ? replies.reverse() : replies);
    } finally {
      active--;
    }
  };

  return {
    fetch,
    posts,
    /** Most POSTs in flight at once. */
    peak: () => peak,
    /** Entries per POST, in arrival order. */
    sizes: () => posts.map((p) => p.calls.length),
  };
}

/** Resolves after `ms`, or rejects like fetch does when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Never answers; rejects when the request is aborted (a hung upstream). */
export function hang(signal?: AbortSignal | null) {
  return sleep(2 ** 31 - 1, signal ?? undefined);
}
