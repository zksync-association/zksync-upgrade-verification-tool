import {
  BEAT_MS,
  Beater,
  PresenceProvider,
  RELOAD_GAP_MS,
  Reloader,
  UNKNOWN_EVERY_MS,
  useHoldUpdates,
  useLive,
  useSafeCheck,
  useWatchItem,
  useWatchKey,
} from "@/components/presence";
import { ListFreshnessNote } from "@/components/verification/freshness";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tab's beats (components/presence.tsx): every 10 s while visible, at once on load, on a change
// of what it shows, on coming back; a leave when hidden or closed, and when nobody touched it for
// the away cut-off; later and later retries while the server does not answer. A beat carries the
// tab's id, a reason and the server's keys, never the page's URL.

const loaderData = vi.hoisted(() => ({ matches: [] as { data: unknown }[] }));
// The router: reloads (revalidate) and whether one, or a navigation, is running.
const router = vi.hoisted(() => ({
  revalidate: (() => {}) as () => void,
  state: "idle" as "idle" | "loading",
  navigation: "idle" as "idle" | "loading",
}));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useMatches: () => loaderData.matches,
  useRevalidator: () => ({ revalidate: router.revalidate, state: router.state }),
  useNavigation: () => ({ state: router.navigation }),
}));

type Sent = { at: number; body: Record<string, unknown>; keepalive: boolean };

function server({ ok = true, nextMs }: { ok?: boolean; nextMs?: number } = {}) {
  const sent: Sent[] = [];
  const state = {
    ok,
    nextMs,
    /** The next answers' extra fields (changed keys, the head, ...). */
    answer: {} as Record<string, unknown>,
  };
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push({
      at: Date.now(),
      body: JSON.parse(String(init?.body)),
      keepalive: init?.keepalive === true,
    });
    if (!state.ok) return new Response("down", { status: 503 });
    return Response.json({
      changed: [],
      unknown: [],
      nextMs: state.nextMs ?? BEAT_MS,
      ...state.answer,
    });
  });
  const beats = () => sent.filter((s) => s.body.reason !== "leave");
  const leaves = () => sent.filter((s) => s.body.reason === "leave");
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent, state, beats, leaves };
}

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

const START = Date.parse("2026-10-07T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  visibility = "visible";
  router.revalidate = () => {};
  router.state = "idle";
  router.navigation = "idle";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  loaderData.matches = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function beater(fetch: typeof globalThis.fetch, awayMs = 30 * 60_000) {
  return new Beater({ awayMs, fetch, tab: "tab-under-test-1" });
}

describe("Beater", () => {
  it("beats at once on start, then every 10 s, with the tab, a reason and the keys only", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.setKeys(["upgrade:0xab", "status", "status"]);
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(up.sent).toHaveLength(1);
    expect(up.sent[0]?.body).toEqual({
      tab: "tab-under-test-1",
      reason: "load",
      items: [
        { key: "status", rev: null },
        { key: "upgrade:0xab", rev: null },
      ],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const times = up.beats().map((s) => s.at - START);
    expect(times).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);
    expect(
      up
        .beats()
        .slice(1)
        .every((s) => s.body.reason === "interval")
    ).toBe(true);
    // Nothing of the page's location is ever sent.
    expect(JSON.stringify(up.sent)).not.toMatch(/http|\/app\/|\?|sig=/);
    b.stop();
  });

  it("follows the server's nextMs, within 2-60 s", async () => {
    const up = server({ nextMs: 500 });
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(up.beats().map((s) => s.at - START)).toEqual([0, 2_000, 4_000, 6_000, 8_000, 10_000]);
    up.state.nextMs = 600_000;
    await vi.advanceTimersByTimeAsync(130_000);
    const late = up
      .beats()
      .slice(-2)
      .map((s) => s.at - START);
    expect((late[1] as number) - (late[0] as number)).toBe(60_000);
    b.stop();
  });

  it("sends a change of keys once it settles (250 ms), as one beat", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(1_000);
    b.setKeys(["status"]);
    b.setKeys(["status", "list:upgrades"]);
    await vi.advanceTimersByTimeAsync(249);
    expect(up.beats()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(up.beats()).toHaveLength(2);
    expect(up.beats()[1]?.body).toMatchObject({
      reason: "nav",
      items: [
        { key: "list:upgrades", rev: null },
        { key: "status", rev: null },
      ],
    });
    // The same keys again: nothing.
    b.setKeys(["list:upgrades", "status"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(up.beats()).toHaveLength(2);
    b.stop();
  });

  it("leaves when hidden and beats nothing until visible again, then at once", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(15_000);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(up.leaves()).toHaveLength(1);
    expect(up.leaves()[0]).toMatchObject({
      keepalive: true,
      body: { reason: "leave", away: false },
    });
    const hiddenAt = Date.now();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(up.sent.filter((s) => s.at > hiddenAt)).toEqual([]);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(up.beats().at(-1)).toMatchObject({ at: Date.now(), body: { reason: "visible" } });
    b.stop();
  });

  it("leaves on pagehide (closed, or into the back/forward cache) and comes back on pageshow", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(up.leaves()).toHaveLength(1);
    const shown = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(shown, "persisted", { value: true });
    window.dispatchEvent(shown);
    await vi.advanceTimersByTimeAsync(0);
    expect(up.beats().at(-1)?.body.reason).toBe("visible");
    b.stop();
  });

  it("stops after the away cut-off without input, says so, and resumes at the next input", async () => {
    const up = server();
    const b = beater(up.fetch, 60_000);
    b.start();
    await vi.advanceTimersByTimeAsync(30_000);
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(100_000);
    // Input at 30 s; the first beat more than 60 s later finds the viewer away.
    expect(up.leaves()).toEqual([
      expect.objectContaining({ body: expect.objectContaining({ away: true }) }),
    ]);
    expect(b.away).toBe(true);
    const awayAt = (up.leaves()[0] as Sent).at;
    expect(awayAt - START).toBe(100_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(up.sent.filter((s) => s.at > awayAt)).toEqual([]);
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(0);
    expect(up.beats().at(-1)?.body.reason).toBe("resume");
    expect(b.away).toBe(false);
    b.stop();
  });

  it("backs off 10 → 20 → 40 → 60 s while the server does not answer, and recovers", async () => {
    const up = server({ ok: false });
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const gaps = up.beats().map((s, i, all) => (i === 0 ? 0 : s.at - (all[i - 1] as Sent).at));
    expect(gaps.slice(0, 6)).toEqual([0, 20_000, 40_000, 60_000, 60_000, 60_000]);
    up.state.ok = true;
    await vi.advanceTimersByTimeAsync(60_000);
    const last = up.beats().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(up.beats()).toHaveLength(last + 1);
    b.stop();
  });

  it("reports a signature at once, with the Safe", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(3_000);
    b.signed("0x59195219d1176E42f8e607e9AC114926D47f9035");
    await vi.advanceTimersByTimeAsync(0);
    expect(up.beats().at(-1)?.body).toMatchObject({
      reason: "signed",
      signed: { safe: "0x59195219d1176E42f8e607e9AC114926D47f9035" },
    });
    b.stop();
  });

  it("inside Safe{Wallet}'s frame, counts a frame scrolled or hidden out of view as hidden", async () => {
    const up = server();
    let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
    // A window framed by another (self is not top), with an IntersectionObserver.
    const frame = Object.assign(new EventTarget(), {
      document,
      navigator: window.navigator,
      self: {},
      top: window,
      IntersectionObserver: class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    }) as unknown as Window;
    const b = new Beater({ awayMs: 0, fetch: up.fetch, tab: "framed-tab-01", win: frame });
    b.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(up.beats()).toHaveLength(2);
    // Safe{Wallet} hides the app's frame (the user left the Safe App): a leave, then nothing.
    report([{ isIntersecting: false }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(up.leaves()).toHaveLength(1);
    expect(up.beats()).toHaveLength(2);
    // Shown again: at once.
    report([{ isIntersecting: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(up.beats().at(-1)?.body.reason).toBe("visible");
    b.stop();
  });

  it("stops for good: a leave, no timer left", async () => {
    const up = server();
    const b = beater(up.fetch);
    b.start();
    await vi.advanceTimersByTimeAsync(1_000);
    b.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(up.leaves()).toHaveLength(1);
    const count = up.sent.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(up.sent).toHaveLength(count);
  });

  it("gives every page its own id, even a duplicated tab's (whose sessionStorage is a copy)", async () => {
    // Duplicate Tab copies sessionStorage: whatever a first page kept there, a second page with the
    // same storage must not take its id, or one tab's leave would end the other.
    const up = server();
    const first = new Beater({ awayMs: 0, fetch: up.fetch });
    const second = new Beater({ awayMs: 0, fetch: up.fetch });
    expect(first.tab).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second.tab).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second.tab).not.toBe(first.tab);
    first.start();
    second.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(new Set(up.beats().map((s) => s.body.tab))).toEqual(new Set([first.tab, second.tab]));
    // The duplicate leaves: only its own id.
    second.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(up.leaves().map((s) => s.body.tab)).toEqual([second.tab]);
    first.stop();
  });
});

describe("PresenceProvider", () => {
  function Item({ id }: { id: string | null }) {
    useWatchKey(id);
    return null;
  }

  it("beats the keys the loaders issued and those the rendered items register", async () => {
    const up = server();
    vi.stubGlobal("fetch", up.fetch);
    loaderData.matches = [
      { data: { watch: [{ key: "status", rev: null }] } },
      { data: { watch: [{ key: "upgrade:0xab", rev: null }], other: 1 } },
      { data: null },
    ];
    const view = render(
      <PresenceProvider awayMs={0}>
        <Item id="set:01" />
        <Item id="set:01" />
        <Item id={null} />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    const keys = (s: Sent) => (s.body.items as { key: string }[]).map((i) => i.key);
    expect(keys(up.beats().at(-1) as Sent)).toEqual(["set:01", "status", "upgrade:0xab"]);
    // One of the two items with the same key unmounts: the key stays; both: it goes.
    view.rerender(
      <PresenceProvider awayMs={0}>
        <Item id="set:01" />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(keys(up.beats().at(-1) as Sent)).toContain("set:01");
    view.rerender(<PresenceProvider awayMs={0}>{null}</PresenceProvider>);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(keys(up.beats().at(-1) as Sent)).toEqual(["status", "upgrade:0xab"]);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(up.leaves()).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe("Reloader (reloading a page after the server said its content changed)", () => {
  function reloader() {
    const reloads: number[] = [];
    const held: boolean[] = [];
    let statusReads = 0;
    const state = { idle: true };
    const r = new Reloader({
      revalidate: () => reloads.push(Date.now() - START),
      idle: () => state.idle,
      statusChanged: () => {
        statusReads++;
      },
      onHeld: (h) => held.push(h),
    });
    return { r, reloads, held, state, statusReads: () => statusReads };
  }

  it("reloads at once for a change, merges changes, and at most once every 5 s", async () => {
    const { r, reloads } = reloader();
    r.noteAnswer({ changed: ["set:01"] });
    expect(reloads).toEqual([0]);
    // Two more changes within the 5 s: one reload, at the end of the gap.
    await vi.advanceTimersByTimeAsync(1_000);
    r.noteAnswer({ changed: ["set:01"] });
    await vi.advanceTimersByTimeAsync(1_000);
    r.noteAnswer({ changed: ["upgrade:0xab", "set:02"] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toEqual([0, RELOAD_GAP_MS]);
    // Nothing changed: no reload.
    r.noteAnswer({ changed: [], unknown: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toHaveLength(2);
    r.stop();
  });

  it("reloads for a key the server does not know at most once a minute (a restart), and reads the root status for a status change", async () => {
    const { r, reloads, statusReads } = reloader();
    r.noteAnswer({ unknown: ["list:upgrades"] });
    await vi.advanceTimersByTimeAsync(10_000);
    r.noteAnswer({ unknown: ["list:upgrades"] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toEqual([0]);
    await vi.advanceTimersByTimeAsync(UNKNOWN_EVERY_MS);
    r.noteAnswer({ unknown: ["list:upgrades"] });
    expect(reloads).toHaveLength(2);
    expect(statusReads()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    r.noteAnswer({ changed: ["status"] });
    expect(reloads).toHaveLength(3);
    expect(statusReads()).toBe(1);
    r.stop();
  });

  it("waits for a navigation or another reload to end", async () => {
    const { r, reloads, state } = reloader();
    state.idle = false;
    r.noteAnswer({ changed: ["set:01"] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reloads).toEqual([]);
    expect(r.waiting).toBe(true);
    state.idle = true;
    r.tryReload();
    expect(reloads).toEqual([30_000]);
    expect(r.waiting).toBe(false);
  });

  it("holds while the viewer is in the middle of something (a Sign dialog), says so, and reloads once released", async () => {
    const { r, reloads, held } = reloader();
    const release = r.hold();
    r.noteAnswer({ changed: ["set:01"] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reloads).toEqual([]);
    expect(held).toEqual([true]);
    // A second hold (a wallet request) keeps it waiting.
    const second = r.hold();
    release();
    expect(reloads).toEqual([]);
    second();
    expect(reloads).toEqual([60_000]);
    expect(held.at(-1)).toBe(false);
    // Released twice: no harm.
    second();
    expect(reloads).toHaveLength(1);
  });

  it("reloads at once when the viewer asked (Fetch signatures), still never under a hold", async () => {
    const { r, reloads } = reloader();
    r.noteAnswer({ changed: ["set:01"] });
    await vi.advanceTimersByTimeAsync(1_000);
    r.force();
    expect(reloads).toEqual([0, 1_000]);
    const release = r.hold();
    r.force();
    expect(reloads).toHaveLength(2);
    release();
    expect(reloads).toEqual([0, 1_000, 1_000]);
  });
});

describe("a list fed by Safe (ListFreshnessNote)", () => {
  it("shows when the beats say its Safes were checked, moving with each check without reloading the page", async () => {
    const up = server();
    vi.stubGlobal("fetch", up.fetch);
    const revalidate = vi.fn();
    router.revalidate = revalidate;
    loaderData.matches = [{ data: { watch: [{ key: "list:vetoes", rev: "4" }] } }];
    const loadedAt = new Date(START - 10 * 60_000).toISOString();
    render(
      <PresenceProvider awayMs={0}>
        <ListFreshnessNote watchKey="list:vetoes" set={{ safeFetchedAt: loadedAt }} />
      </PresenceProvider>
    );
    // Before a beat answered: the age of the copies the page loaded with.
    expect(screen.getByTestId("set-freshness")).toHaveTextContent("Safe copies from 10m ago");
    up.state.answer = {
      checked: {
        "list:vetoes": {
          state: "watching",
          checkedAt: new Date(START - 20_000).toISOString(),
          nextAt: new Date(START + 280_000).toISOString(),
          cadenceMs: 300_000,
          reason: null,
        },
      },
    };
    await act(() => vi.advanceTimersByTimeAsync(BEAT_MS));
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(
      /^Safe checked \d+s ago · next check in 4m$/
    );
    // Nothing changed in the list: no reload.
    expect(revalidate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("reloads and a hidden tab", () => {
  it("never reloads while the tab is hidden (a reload is a page load the server counts as use): one waiting goes once it is visible again", async () => {
    const up = server({ nextMs: 2_000 });
    vi.stubGlobal("fetch", up.fetch);
    const revalidate = vi.fn();
    router.revalidate = revalidate;
    loaderData.matches = [
      { data: { watch: [{ key: "set:01", rev: null }], revs: [{ key: "set:01", rev: "1" }] } },
    ];
    render(
      <PresenceProvider awayMs={0}>
        <span />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    up.state.answer = { changed: ["set:01"] };
    // The first change reloads at once; the next, 2 s later, waits for the 5 s gap.
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(revalidate).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(revalidate).toHaveBeenCalledTimes(1);
    // The tab is hidden before the gap ends: nothing reloads while it is.
    up.state.answer = { changed: [] };
    await act(async () => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(revalidate).toHaveBeenCalledTimes(1);
    // Back: the waiting reload goes.
    await act(async () => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(revalidate).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("Check Safe now on a list: the label says the check at once", () => {
  it("applies the check's answer to what the label shows, without waiting for the next beat", async () => {
    const up = server();
    const check = (ago: number) => ({
      state: "watching",
      checkedAt: new Date(Date.now() - ago).toISOString(),
      nextAt: new Date(Date.now() + 300_000 - ago).toISOString(),
      cadenceMs: 300_000,
      reason: null,
    });
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) =>
      String(url).endsWith("/resources/safe-check")
        ? Response.json({ key: "list:vetoes", rev: "4", checked: 3, failed: 0, check: check(0) })
        : up.fetch(url as string, init)
    );
    vi.stubGlobal("fetch", fetch);
    loaderData.matches = [{ data: { watch: [{ key: "list:vetoes", rev: "4" }] } }];
    up.state.answer = { checked: { "list:vetoes": check(90_000) } };
    let press: (() => Promise<void>) | null = null;
    function Press() {
      press = useSafeCheck("list:vetoes").run;
      return null;
    }
    render(
      <PresenceProvider awayMs={0}>
        <Press />
        <ListFreshnessNote watchKey="list:vetoes" set={{}} />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(/^Safe checked 1m ago/);
    await act(async () => {
      await (press as unknown as () => Promise<void>)();
    });
    // At once (the next beat is 10 s away): the check just made.
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(/^Safe checked [0-1]s ago/);
    vi.unstubAllGlobals();
  });
});

describe("PresenceProvider: revisions and reloads", () => {
  function Item({ item }: { item: { key: string; rev: string | null } | null }) {
    useWatchItem(item);
    return null;
  }

  it("beats each key with the revision rendered: the loaders' (deferred), and those the items register", async () => {
    const up = server();
    vi.stubGlobal("fetch", up.fetch);
    let resolve!: (items: unknown) => void;
    const revs = new Promise((r) => {
      resolve = r;
    });
    loaderData.matches = [
      { data: { watch: [{ key: "status", rev: null }], revs } },
      {
        data: {
          watch: [{ key: "upgrade:0xab", rev: null }],
          revs: [{ key: "upgrade:0xab", rev: "5" }],
        },
      },
    ];
    render(
      <PresenceProvider awayMs={0}>
        <Item item={{ key: "set:01", rev: "7" }} />
        <Item item={{ key: "set:01", rev: "7" }} />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    const items = (s: Sent) => s.body.items as { key: string; rev: string | null }[];
    expect(items(up.beats().at(-1) as Sent)).toEqual([
      { key: "set:01", rev: "7" },
      { key: "status", rev: null },
      { key: "upgrade:0xab", rev: "5" },
    ]);
    // The root's revision arrives: the next beat carries it.
    await act(async () => resolve([{ key: "status", rev: "3" }]));
    await act(() => vi.advanceTimersByTimeAsync(BEAT_MS));
    expect(items(up.beats().at(-1) as Sent)).toContainEqual({ key: "status", rev: "3" });
    // Never any part of the URL.
    expect(JSON.stringify(up.sent)).not.toContain("?sig=");
    vi.unstubAllGlobals();
  });

  it("reloads the page once when the server says its content changed, says so while it runs, and carries the head, the index and Era from the answer", async () => {
    const up = server();
    vi.stubGlobal("fetch", up.fetch);
    const revalidate = vi.fn();
    router.revalidate = revalidate;
    loaderData.matches = [
      { data: { watch: [{ key: "set:01", rev: null }], revs: [{ key: "set:01", rev: "1" }] } },
    ];
    function Live() {
      const live = useLive();
      return (
        <p data-testid="live">
          {live.head?.number ?? "-"}|{live.eraAt["l2:0x01:1"]?.number ?? "-"}|
          {live.updating ? "updating" : "idle"}
        </p>
      );
    }
    const view = render(
      <PresenceProvider awayMs={0}>
        <Live />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(revalidate).not.toHaveBeenCalled();
    up.state.answer = {
      changed: ["set:01"],
      head: { number: "101", hash: "0x01", timestamp: "1" },
      eraAt: { "l2:0x01:1": { number: "7000", readAt: new Date(START).toISOString() } },
    };
    await act(() => vi.advanceTimersByTimeAsync(BEAT_MS));
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("live")).toHaveTextContent("101|7000|updating");
    // The reload runs, then ends with the new revision: no further reload.
    router.state = "loading";
    view.rerender(
      <PresenceProvider awayMs={0}>
        <Live />
      </PresenceProvider>
    );
    up.state.answer = { changed: [] };
    router.state = "idle";
    loaderData.matches = [
      { data: { watch: [{ key: "set:01", rev: null }], revs: [{ key: "set:01", rev: "2" }] } },
    ];
    view.rerender(
      <PresenceProvider awayMs={0}>
        <Live />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(3 * BEAT_MS));
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("live")).toHaveTextContent("101|-|idle");
    vi.unstubAllGlobals();
  });

  it("holds a reload while a Sign dialog is open, showing that new data waits, and applies it on close", async () => {
    const up = server();
    vi.stubGlobal("fetch", up.fetch);
    const revalidate = vi.fn();
    router.revalidate = revalidate;
    loaderData.matches = [{ data: { revs: [{ key: "set:01", rev: "1" }] } }];
    function Dialog({ open }: { open: boolean }) {
      const waiting = useHoldUpdates(open);
      return waiting ? <p>New data · applies when you close this</p> : null;
    }
    const ui = (open: boolean) => (
      <PresenceProvider awayMs={0}>
        <Dialog open={open} />
      </PresenceProvider>
    );
    const view = render(ui(true));
    up.state.answer = { changed: ["set:01"] };
    await act(() => vi.advanceTimersByTimeAsync(3 * BEAT_MS));
    expect(revalidate).not.toHaveBeenCalled();
    expect(screen.getByText("New data · applies when you close this")).toBeInTheDocument();
    up.state.answer = {};
    view.rerender(ui(false));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("New data · applies when you close this")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("Fetch signatures: asks the server to read the Safes now, then reloads the page at once; a second press while it runs does nothing", async () => {
    const posts: unknown[] = [];
    let answer!: (r: Response) => void;
    const beats = server();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url !== "/resources/safe-check") return beats.fetch(url, init);
      posts.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((r) => {
        answer = r;
      });
    });
    const revalidate = vi.fn();
    router.revalidate = revalidate;
    let check!: ReturnType<typeof useSafeCheck>;
    function Button() {
      check = useSafeCheck("set:01");
      return <p data-testid="check">{check.running ? "running" : check.error ?? "idle"}</p>;
    }
    render(
      <PresenceProvider awayMs={0}>
        <Button />
      </PresenceProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    await act(async () => {
      void check.run();
      void check.run();
    });
    expect(posts).toEqual([{ key: "set:01" }]);
    expect(screen.getByTestId("check")).toHaveTextContent("running");
    await act(async () =>
      answer(Response.json({ key: "set:01", rev: "9", checked: 8, failed: 0 }))
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByTestId("check")).toHaveTextContent("idle");
    expect(revalidate).toHaveBeenCalledTimes(1);
    // The app does not answer at all (stopped, offline): said so, not the browser's text.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url !== "/resources/safe-check") return beats.fetch(url, init);
      throw new TypeError("Failed to fetch");
    });
    await act(async () => {
      await check.run();
    });
    expect(screen.getByTestId("check")).toHaveTextContent("the app is not answering; try again");
    expect(revalidate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
