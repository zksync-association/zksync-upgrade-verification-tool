import { BEAT_MS, Beater, PresenceProvider, useWatchKey } from "@/components/presence";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tab's beats (components/presence.tsx): every 10 s while visible, at once on load, on a change
// of what it shows, on coming back; a leave when hidden or closed, and when nobody touched it for
// the away cut-off; later and later retries while the server does not answer. A beat carries the
// tab's id, a reason and the server's keys, never the page's URL.

const loaderData = vi.hoisted(() => ({ matches: [] as { data: unknown }[] }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useMatches: () => loaderData.matches,
}));

type Sent = { at: number; body: Record<string, unknown>; keepalive: boolean };

function server({ ok = true, nextMs }: { ok?: boolean; nextMs?: number } = {}) {
  const sent: Sent[] = [];
  const state = { ok, nextMs };
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push({
      at: Date.now(),
      body: JSON.parse(String(init?.body)),
      keepalive: init?.keepalive === true,
    });
    if (!state.ok) return new Response("down", { status: 503 });
    return Response.json({ changed: [], unknown: [], nextMs: state.nextMs ?? BEAT_MS });
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
