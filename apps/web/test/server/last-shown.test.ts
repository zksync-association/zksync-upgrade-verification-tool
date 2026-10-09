import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { clearCache } from "@/.server/cache";
import { overrideCodePinsForTests } from "@/.server/chain/pins";
import { resetVerdicts } from "@/.server/chain/verdicts";
import { latestBlock, network, resetRpcClients, servedHeadNow } from "@/.server/rpc";
import { resetSafeClient } from "@/.server/safe-api";
import { resetContent } from "@/.server/sync/content-engine";
import { stopSync } from "@/.server/sync/engine";
import {
  LAST_SHOWN_LIMIT,
  lastShown,
  lastShownSize,
  resetLastShown,
} from "@/.server/sync/last-shown";
import { resetPresence } from "@/.server/sync/presence";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PINS } from "../support/fake-l1";
import { HEAD, NOW, SLOT_MS, backfilled, liveWorld, settle } from "../support/live-world";

// After a pause the app has no head in memory (nothing was read while nobody used it), so a
// page's sections must read the newest block before they have anything to show. What a page last
// showed as current is kept in memory (sync/last-shown.ts) and shown first then, labelled with the
// block it was read at, until the current answer replaces it in the same response: never from a
// stale or unconfirmed answer, never across a settings change, never on JSON.

const WEB = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A section whose answer is read at the head: the block it was read at. */
const atHead = () => latestBlock().then((head) => ({ block: head.number.toString() }));

/** Whether `promise` settles without the fake clock moving (no upstream answer can arrive). */
async function settlesAtOnce<T>(promise: Promise<T>): Promise<{ value: T } | null> {
  let settled: { value: T } | null = null;
  void promise.then((value) => {
    settled = { value };
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return settled;
}

/** The pause: the head read 4 s ago is no longer served, and no engine runs to read another. */
async function pause(w: ReturnType<typeof liveWorld>) {
  await vi.advanceTimersByTimeAsync(SLOT_MS);
  w.nextBlock();
  expect(servedHeadNow()).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearCache();
  resetRpcClients();
  resetSafeClient();
  resetPresence({ keepWarmMs: 30_000 });
  resetVerdicts();
  resetContent();
  resetLastShown();
  overrideCodePinsForTests(FAKE_PINS);
});

afterEach(() => {
  stopSync();
  overrideCodePinsForTests(undefined);
  resetPresence();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a section after a pause", () => {
  it("shows what it last showed at once, as of its block, and the current answer after it", async () => {
    const w = liveWorld();
    await backfilled();
    const before = lastShown().section("k", atHead(), Promise.resolve(null), {
      current: () => true,
    });
    expect(await settle(before.first)).toEqual({ block: HEAD.toString() });
    expect(await settle(before.fresh)).toBeNull();
    await settle(Promise.resolve());

    await pause(w);
    const posts = w.fake.posts.length;
    const after = lastShown().section("k", atHead(), Promise.resolve(null), {
      current: () => true,
    });
    // At once, with nothing upstream answered: what it showed, with the block it was read at.
    const first = await settlesAtOnce(after.first);
    expect(first?.value).toMatchObject({
      block: HEAD.toString(),
      asOf: { block: HEAD.toString() },
    });
    expect(w.fake.posts.length - posts).toBeLessThanOrEqual(1);
    // The current answer follows, at the newest block, without a label.
    const fresh = await settle(after.fresh);
    expect(fresh).toEqual({ block: (HEAD + 1n).toString() });
    expect(fresh).not.toHaveProperty("asOf");
  });

  it("is the current answer as ever while a head is in memory", async () => {
    liveWorld();
    await backfilled();
    await settle(
      lastShown().section("k", atHead(), Promise.resolve(null), { current: () => true }).first
    );
    expect(servedHeadNow()).not.toBeNull();
    const again = lastShown().section(
      "k",
      Promise.resolve({ block: "now" }),
      Promise.resolve(null),
      {
        current: () => true,
      }
    );
    expect(await settle(again.first)).toEqual({ block: "now" });
    expect(await settle(again.fresh)).toBeNull();
  });

  it("labels with the head the section's reads used, never a newer one", async () => {
    const w = liveWorld();
    await backfilled();
    await pause(w);
    // The section reads the newest block (HEAD + 1), then takes a while: a newer block is served
    // before it answers.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = lastShown().section(
      "k",
      atHead().then(async (value) => {
        await gate;
        return value;
      }),
      Promise.resolve(null),
      { current: () => true }
    );
    await vi.advanceTimersByTimeAsync(SLOT_MS);
    w.nextBlock();
    expect((await settle(latestBlock())).number).toBe(HEAD + 2n);
    release();
    expect(await settle(slow.first)).toEqual({ block: (HEAD + 1n).toString() });
    await settle(Promise.resolve());

    await pause(w);
    const shown = await settlesAtOnce(lastShown().held("k"));
    expect(shown?.value).toMatchObject({
      block: (HEAD + 1n).toString(),
      asOf: { block: (HEAD + 1n).toString() },
    });
  });

  it("keeps only a current answer: never a first answer that was not, nor one that failed", async () => {
    const w = liveWorld();
    await backfilled();
    // A first answer from older sources, and the current one after it: the current one is kept.
    const mixed = lastShown().section(
      "mixed",
      Promise.resolve({ stale: true, n: 1 }),
      atHead().then(() => ({ stale: false, n: 2 })),
      { current: (v) => !v.stale }
    );
    await settle(mixed.fresh);
    // An answer that is not current (it says so) is not kept, nor one that failed.
    lastShown().section("old", Promise.resolve({ stale: true }), Promise.resolve(null), {
      current: (v) => !v.stale,
    });
    const failing = lastShown().section(
      "failed",
      Promise.reject(new Error("upstream")),
      Promise.resolve(null),
      {
        current: () => true,
      }
    );
    await expect(settle(failing.first)).rejects.toThrow("upstream");
    await settle(Promise.resolve());

    await pause(w);
    const shown = lastShown();
    expect(await settlesAtOnce(shown.held("mixed"))).toMatchObject({
      value: { stale: false, n: 2, asOf: { block: HEAD.toString() } },
    });
    expect(await settlesAtOnce(shown.held("old"))).toEqual({ value: null });
    expect(await settlesAtOnce(shown.held("failed"))).toEqual({ value: null });
  });

  it("labels what it shows first with `label`, and the current answer replaces it", async () => {
    const w = liveWorld();
    await backfilled();
    await settle(
      lastShown().section(
        "list",
        atHead().then(() => ({ stale: false })),
        Promise.resolve(null),
        {
          current: (v) => !v.stale,
        }
      ).first
    );
    await pause(w);
    const after = lastShown().section(
      "list",
      atHead().then(() => ({ stale: false })),
      Promise.resolve(null),
      { current: (v) => !v.stale, label: (v) => ({ ...v, stale: true }) }
    );
    expect((await settlesAtOnce(after.first))?.value).toMatchObject({ stale: true });
    expect(await settle(after.fresh)).toEqual({ stale: false });
  });

  it("forgets everything on a settings change, and keeps a bounded number of sections", async () => {
    const w = liveWorld();
    await backfilled();
    for (let i = 0; i < LAST_SHOWN_LIMIT + 5; i++) lastShown().keep(`k${i}`, atHead(), () => true);
    await settle(latestBlock());
    await settle(Promise.resolve());
    expect(lastShownSize()).toBe(LAST_SHOWN_LIMIT);
    await pause(w);
    // The oldest are gone, the newest kept.
    const shown = lastShown();
    expect(await settlesAtOnce(shown.held("k4"))).toEqual({ value: null });
    for (const i of [5, LAST_SHOWN_LIMIT + 4])
      expect((await settlesAtOnce(shown.held(`k${i}`)))?.value).toMatchObject({
        asOf: { block: HEAD.toString() },
      });

    // Another RPC (maybe another chain): what pages showed under the old settings is never shown.
    resetRpcClients();
    await backfilled();
    await pause(w);
    expect(await settlesAtOnce(lastShown().held(`k${LAST_SHOWN_LIMIT + 4}`))).toEqual({
      value: null,
    });
    // And dropping cached answers drops these too.
    clearCache();
    expect(lastShownSize()).toBe(0);
  });

  it("does nothing on a dev node, which can be rewound", async () => {
    const w = liveWorld({ clientVersion: "anvil/v0.2.0" });
    expect((await settle(network())).isDevNode).toBe(true);
    lastShown().keep("k", atHead(), () => true);
    await settle(latestBlock());
    await settle(Promise.resolve());
    expect(lastShownSize()).toBe(0);
    await pause(w);
    expect(await settlesAtOnce(lastShown().held("k"))).toEqual({ value: null });
  });
});

describe("where it is used", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]
    );

  it("only page loaders use it: no JSON route, flow or the engine", () => {
    const users = files(join(WEB, "app"))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => /from "[^"]*sync\/last-shown"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(WEB, file))
      .sort();
    expect(users).toEqual([
      "app/.server/rpc.ts",
      "app/routes/_index/_route.tsx",
      "app/routes/app/emergency/$id/_route.tsx",
      "app/routes/app/emergency/_index/_route.tsx",
      "app/routes/app/l2-cancellations/_index/_route.tsx",
      "app/routes/app/proposals/$id/_route.tsx",
      "app/routes/app/proposals/_index/_route.tsx",
    ]);
    // rpc.ts only gives it the head.
    expect(readFileSync(join(WEB, "app/.server/rpc.ts"), "utf8")).toMatch(
      /import \{ provideHeads \} from "\.\/sync\/last-shown";/
    );
  });
});
