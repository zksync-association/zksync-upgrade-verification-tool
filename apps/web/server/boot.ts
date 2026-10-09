// The server's start, before it listens: what every first page needs from the app build before
// any request can arrive. Each step is bounded and never stops the server.

/** What the app build's entry module exports for the start (app/entry.server.tsx). */
export type BootEntry = {
  readNetwork?: () => Promise<void>;
  loadChainCache?: () => Promise<void>;
};

/** How long the start waits for each step before it listens anyway. */
export type BootWaits = { networkMs: number; chainCacheMs: number };

/** Waits for `work` at most `ms`; never rejects. */
export async function bounded(work: (() => Promise<unknown>) | undefined, ms: number) {
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => work())
        .catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Before the server listens, together: which chain the RPC is on (the first page's app shell and
 * its wallet then never wait for it), and the chain cache kept from the last run, checked against
 * the chain and seeded (a page opened at once then answers from it instead of waiting for it).
 * Each is bounded: past its wait the server listens anyway, and a page that may answer from the
 * cache waits for it on its own (at most SEED_WAIT_MS). Never rejects.
 */
export async function beforeListening(entry: BootEntry, waits: BootWaits): Promise<void> {
  await Promise.all([
    bounded(entry.readNetwork, waits.networkMs),
    bounded(entry.loadChainCache, waits.chainCacheMs),
  ]);
}
