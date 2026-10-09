import { INITIAL_LIVE, LiveStateProvider } from "@/components/presence";
import {
  BlockAge,
  IndexProgressProvider,
  type IndexStatusView,
  IndexedLoadingCard,
  IndexingPill,
  indexProgress,
  indexingLabel,
} from "@/components/sync-state";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ list: new Promise(() => {}) as Promise<unknown> }));
vi.mock("@/.server/flows/standard", () => ({ listStandardUpgrades: vi.fn() }));
vi.mock("@remix-run/react", async (original) => ({
  ...(await original<typeof import("@remix-run/react")>()),
  useLoaderData: () => ({ list: data.list, allHistory: false }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const { default: Proposals } = await import("@/routes/app/proposals/_index/_route");

function index(overrides: Partial<IndexStatusView> = {}): IndexStatusView {
  return {
    state: "backfilling",
    deployBlock: "20000000",
    coveredFrom: null,
    finalizedTo: "21000000",
    headTo: null,
    chunks: { done: 0, total: 0 },
    strategy: null,
    span: null,
    logs: 0,
    error: null,
    provisional: null,
    ...overrides,
  };
}

describe("indexProgress", () => {
  it("is not indexing once ready, unavailable or idle", () => {
    for (const state of ["ready", "unavailable", "idle"] as const)
      expect(indexProgress(index({ state, chunks: { done: 3, total: 9 } }))).toEqual({
        indexing: false,
        percent: null,
      });
    expect(indexProgress(null)).toEqual({ indexing: false, percent: null });
  });

  it("measures chunks landed of chunks planned, below 100 until ready", () => {
    expect(indexProgress(index({ chunks: { done: 37, total: 100 } })).percent).toBe(37);
    expect(indexProgress(index({ chunks: { done: 100, total: 100 } })).percent).toBe(99);
  });

  it("falls back to the covered share of the history, or no measure at all", () => {
    expect(indexProgress(index({ coveredFrom: "20750000" })).percent).toBe(25);
    expect(indexProgress(index())).toEqual({ indexing: true, percent: null });
    expect(indexProgress(index({ deployBlock: null })).percent).toBeNull();
  });
});

describe("the indexing state never renders a 0", () => {
  it.each([
    ["no measure yet", index()],
    ["0 chunks of 435", index({ chunks: { done: 0, total: 435 } })],
    ["under 1%", index({ chunks: { done: 3, total: 435 } })],
  ])("labels %s as indexing, without a number", (_name, status) => {
    const progress = indexProgress(status);
    expect(indexingLabel(progress)).toBe("Indexing…");
    expect(indexingLabel(progress, "log history")).toBe("Indexing log history…");
    const { container } = render(
      <IndexProgressProvider initial={status}>
        <IndexingPill />
        <IndexedLoadingCard label="Reading UpgradeStarted events…" />
      </IndexProgressProvider>
    );
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing…");
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("shows the percentage once there is one", () => {
    const status = index({ chunks: { done: 160, total: 435 } });
    render(
      <IndexProgressProvider initial={status}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 36%");
    expect(indexingLabel(indexProgress(status), "log history")).toBe("Indexing log history · 36%");
  });

  it("keeps the word for screen readers only below sm, so the header fits a phone", () => {
    render(
      <IndexProgressProvider initial={index({ chunks: { done: 160, total: 435 } })}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    const word = screen.getByText("Indexing", { exact: false, selector: "span.sr-only" });
    expect(word).toHaveClass("sm:not-sr-only");
    expect(screen.getByRole("status")).toHaveTextContent("Indexing 36%");
  });

  it("shows the root status's progress until the provider has its own (on the server)", () => {
    const html = renderToString(
      <IndexProgressProvider initial={null}>
        <IndexingPill fallback={index({ chunks: { done: 160, total: 435 } })} />
      </IndexProgressProvider>
    );
    expect(html).toContain("36%");
  });

  it("shows nothing once the index is ready", () => {
    const { container } = render(
      <IndexProgressProvider initial={index({ state: "ready" })}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a list that is still loading from looking like an empty one", () => {
    data.list = new Promise(() => {});
    const { container } = render(
      <IndexProgressProvider initial={index()}>
        <Proposals />
      </IndexProgressProvider>
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Indexing the upgrade handler's log history; the list appears once its range is covered."
    );
    expect(screen.queryByText(/No upgrade is waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No finished upgrades/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });
});

describe("IndexProgressProvider (fed by the tab's beats)", () => {
  const fetch = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetch.mockReset();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The provider under what the last beat said about the index (null: no beat yet). */
  const view = (
    initial: IndexStatusView | null,
    beat: IndexStatusView | null,
    onSettled?: () => void
  ) => (
    <LiveStateProvider value={{ ...INITIAL_LIVE, index: beat as never }}>
      <IndexProgressProvider initial={initial} onSettled={onSettled}>
        <IndexingPill />
      </IndexProgressProvider>
    </LiveStateProvider>
  );

  it("shows the root status's progress, then each beat's, and asks nothing of its own", async () => {
    const first = index({ chunks: { done: 40, total: 435 } });
    const shown = render(view(first, null));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 9%");
    shown.rerender(view(first, index({ chunks: { done: 200, total: 435 } })));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 45%");
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    // No /api/status poll, visible or not: the beats (which stop while hidden) carry it.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports once that the index settled (ready or unavailable), so the root status is read again", async () => {
    for (const settled of [
      index({ state: "ready" }),
      index({ state: "unavailable", error: "x" }),
    ]) {
      const onSettled = vi.fn();
      const first = index({ chunks: { done: 40, total: 435 } });
      const shown = render(view(first, null, onSettled));
      shown.rerender(view(first, index({ chunks: { done: 300, total: 435 } }), onSettled));
      expect(onSettled).not.toHaveBeenCalled();
      shown.rerender(view(first, settled, onSettled));
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
      // Further beats saying the same: nothing more.
      shown.rerender(view(first, { ...settled }, onSettled));
      expect(onSettled).toHaveBeenCalledTimes(1);
      shown.unmount();
    }
  });

  it("reports nothing when the root status already had the index settled", () => {
    const onSettled = vi.fn();
    const ready = index({ state: "ready" });
    const shown = render(view(ready, null, onSettled));
    shown.rerender(view(ready, { ...ready }, onSettled));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("follows a backfill that starts after the root status (read right after a settings save)", () => {
    const onSettled = vi.fn();
    const idle = index({ state: "idle" });
    const shown = render(view(idle, null, onSettled));
    shown.rerender(view(idle, index({ chunks: { done: 10, total: 435 } }), onSettled));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 2%");
    shown.rerender(view(idle, index({ state: "ready" }), onSettled));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("takes a newer root status over what the beats said", () => {
    const first = index({ chunks: { done: 40, total: 435 } });
    const shown = render(view(first, index({ chunks: { done: 200, total: 435 } })));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 45%");
    // Refresh: a new root status (the beat in hand is the same object as before).
    const beat = index({ chunks: { done: 200, total: 435 } });
    shown.rerender(view(first, beat));
    shown.rerender(view(index({ chunks: { done: 100, total: 435 } }), beat));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 22%");
  });
});

describe("BlockAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:12Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const block = {
    number: "23500000",
    timestamp: String(Date.parse("2026-10-06T12:00:00Z") / 1000),
  };

  it("shows the block and how long ago it was mined, by this browser's clock", async () => {
    render(<BlockAge block={block} />);
    expect(screen.getByTestId("block-age")).toHaveTextContent("block #23,500,000 · 12s ago");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByTestId("block-age")).toHaveTextContent("block #23,500,000 · 1m ago");
  });

  it("renders no age on the server, so hydration matches", () => {
    const html = renderToString(<BlockAge block={block} />);
    expect(html).toContain("block #<!-- -->23,500,000");
    expect(html).not.toContain("ago");
  });

  it("never shows a negative age when the browser's clock is behind", () => {
    vi.setSystemTime(new Date("2026-10-06T11:59:00Z"));
    render(<BlockAge block={block} />);
    expect(screen.getByTestId("block-age")).toHaveTextContent("· 0s ago");
  });
});
