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
    ...overrides,
  };
}

const okStatus = (i: IndexStatusView) => ({ ok: true, sync: { index: i } });

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

describe("IndexProgressProvider polling", () => {
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

  const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) });
  const pollOnce = () => act(() => vi.advanceTimersByTimeAsync(2_000));

  it("polls /api/status while backfilling, and stops once ready", async () => {
    fetch
      .mockReturnValueOnce(answer(okStatus(index({ chunks: { done: 200, total: 435 } }))))
      .mockReturnValueOnce(answer(okStatus(index({ state: "ready" }))));
    render(
      <IndexProgressProvider initial={index({ chunks: { done: 40, total: 435 } })}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 9%");
    await pollOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/status");
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 45%");
    await pollOnce();
    expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the last progress through a failed poll and polls again", async () => {
    fetch
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockReturnValueOnce(answer({ error: "upstream" }))
      .mockReturnValueOnce(answer(okStatus(index({ chunks: { done: 300, total: 435 } }))));
    render(
      <IndexProgressProvider initial={index({ chunks: { done: 40, total: 435 } })}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    await pollOnce();
    await pollOnce();
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 9%");
    await pollOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 68%");
  });

  it.each(["ready", "unavailable"] as const)(
    "never polls once the index is %s (an idle tab stays idle)",
    async (state) => {
      const onSettled = vi.fn();
      render(
        <IndexProgressProvider initial={index({ state })} onSettled={onSettled}>
          <IndexingPill />
        </IndexProgressProvider>
      );
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(fetch).not.toHaveBeenCalled();
      expect(onSettled).not.toHaveBeenCalled();
    }
  );

  it.each(["ready", "unavailable"] as const)(
    "reports once that the index settled (%s), so the root status is read again",
    async (state) => {
      const onSettled = vi.fn();
      fetch
        .mockReturnValueOnce(answer(okStatus(index({ chunks: { done: 200, total: 435 } }))))
        .mockReturnValueOnce(answer(okStatus(index({ state }))));
      render(
        <IndexProgressProvider
          initial={index({ chunks: { done: 40, total: 435 } })}
          onSettled={onSettled}
        >
          <IndexingPill />
        </IndexProgressProvider>
      );
      await pollOnce();
      expect(onSettled).not.toHaveBeenCalled();
      await pollOnce();
      expect(onSettled).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(onSettled).toHaveBeenCalledTimes(1);
    }
  );

  it("polls while the backfill has not started yet (the root status read right after a settings save)", async () => {
    const onSettled = vi.fn();
    fetch
      .mockReturnValueOnce(answer(okStatus(index({ state: "idle" }))))
      .mockReturnValueOnce(answer(okStatus(index({ chunks: { done: 100, total: 435 } }))))
      .mockReturnValueOnce(answer(okStatus(index({ state: "ready" }))));
    render(
      <IndexProgressProvider initial={index({ state: "idle" })} onSettled={onSettled}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
    await pollOnce();
    await pollOnce();
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 22%");
    await pollOnce();
    expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("does not report a settled index from a poll sent before a newer root status", async () => {
    const onSettled = vi.fn();
    let resolve: (value: unknown) => void = () => {};
    fetch.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const view = render(
      <IndexProgressProvider
        initial={index({ chunks: { done: 40, total: 435 } })}
        onSettled={onSettled}
      >
        <IndexingPill />
      </IndexProgressProvider>
    );
    await pollOnce();
    view.rerender(
      <IndexProgressProvider initial={index({ state: "ready" })} onSettled={onSettled}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    await act(async () =>
      resolve({ json: () => Promise.resolve(okStatus(index({ state: "ready" }))) })
    );
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("drops a poll's late answer once a newer root status arrived", async () => {
    let resolve: (value: unknown) => void = () => {};
    fetch.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    const first = index({ chunks: { done: 40, total: 435 } });
    const view = render(
      <IndexProgressProvider initial={first}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    await pollOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    // Refresh: the root status is newer than the poll still out.
    view.rerender(
      <IndexProgressProvider initial={index({ chunks: { done: 400, total: 435 } })}>
        <IndexingPill />
      </IndexProgressProvider>
    );
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 91%");
    await act(async () => resolve({ json: () => Promise.resolve(okStatus(first)) }));
    expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 91%");
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
