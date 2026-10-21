// Before the server listens: the reads every first page needs from the app build. Each is bounded:
// past its wait the server listens anyway, and a failure never stops it.

export type BootEntry = {
  readNetwork?: () => Promise<void>;
  loadChainCache?: () => Promise<void>;
};

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

export async function beforeListening(entry: BootEntry, waits: BootWaits): Promise<void> {
  await Promise.all([
    bounded(entry.readNetwork, waits.networkMs),
    bounded(entry.loadChainCache, waits.chainCacheMs),
  ]);
}
