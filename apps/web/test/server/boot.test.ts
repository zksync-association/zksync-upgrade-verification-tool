import { beforeListening, bounded } from "@server/boot";
import { afterEach, describe, expect, it, vi } from "vitest";

// Before the server listens it reads which chain the RPC is on and loads the chain cache kept
// from the last run, together and each bounded: a page opened at liftoff then finds the last
// run's history seeded instead of waiting for it, and a slow or failing step never stops the
// server from listening.

const waits = { networkMs: 3_000, chainCacheMs: 3_000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("the start before listening", () => {
  it("loads the chain cache before it listens, beside the network read", async () => {
    const order: string[] = [];
    let cacheStarted = false;
    await beforeListening(
      {
        readNetwork: async () => {
          order.push("network");
        },
        loadChainCache: async () => {
          cacheStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push("chain-cache");
        },
      },
      waits
    );
    order.push("listen");
    expect(cacheStarted).toBe(true);
    expect(order).toEqual(["network", "chain-cache", "listen"]);
  });

  it("runs both reads together, not one after the other", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = beforeListening(
      {
        readNetwork: async () => {
          started.push("network");
          await gate;
        },
        loadChainCache: async () => {
          started.push("chain-cache");
          await gate;
        },
      },
      waits
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started.sort()).toEqual(["chain-cache", "network"]);
    release();
    await done;
  });

  it("listens anyway once a step's wait is over, and when a step fails", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void beforeListening(
      {
        readNetwork: () => Promise.reject(new Error("eth_chainId failed")),
        loadChainCache: () => new Promise(() => {}),
      },
      { networkMs: 3_000, chainCacheMs: 2_000 }
    ).then(done);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it("does without what the app build does not export", async () => {
    await expect(beforeListening({}, waits)).resolves.toBeUndefined();
  });
});

describe("bounded", () => {
  it("never rejects, even when the work throws before returning a promise", async () => {
    await expect(
      bounded(() => {
        throw new Error("sync");
      }, 10)
    ).resolves.toBeUndefined();
    await expect(bounded(() => Promise.reject(new Error("async")), 10)).resolves.toBeUndefined();
    await expect(bounded(undefined, 10)).resolves.toBeUndefined();
  });
});
