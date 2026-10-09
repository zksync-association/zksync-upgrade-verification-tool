import type { OkStatus } from "@/components/governance-context";
import { resetStatusRevalidation, shouldRevalidateRoot } from "@/utils/revalidation";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The root status is not read again on its own: when a beat shows the index finished, the shell
// reads it once, for the log-history check that had no opinion while the index was backfilling.
// Nothing is polled: the beats carry the index's state.

const router = vi.hoisted(() => ({ revalidate: vi.fn() }));
vi.mock("@remix-run/react", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: router.revalidate, state: "idle" }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  NavLink: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("react-hot-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/connect-button", async () => {
  const { createContext } = await import("react");
  return { default: () => null, WalletOfferContext: createContext(() => {}) };
});

const { default: AppShell } = await import("@/components/app-shell");
const { INITIAL_LIVE, LiveStateProvider } = await import("@/components/presence");

/** The shell, with what the tab's last beat said about the index (null: no beat yet). */
function shell(root: OkStatus, beat: Record<string, unknown> | null = null) {
  return (
    <LiveStateProvider value={{ ...INITIAL_LIVE, index: beat as never }}>
      <AppShell status={root}>page</AppShell>
    </LiveStateProvider>
  );
}

const ADDRESS = "0x0000000000000000000000000000000000000001";
const READY = {
  state: "ready",
  deployBlock: "20000000",
  coveredFrom: "20000000",
  finalizedTo: "21000000",
  headTo: "21000064",
  chunks: { done: 435, total: 435 },
  strategy: "chunked",
  span: "10000",
  logs: 120,
  error: null,
};

function status(
  index: Record<string, unknown>,
  logHistory: Record<string, unknown> = { status: "ok" }
): OkStatus {
  return {
    ok: true,
    governance: {
      network: { label: "Ethereum", chainId: 1, isDevNode: false, overrides: [] },
      latestBlock: { number: "21000064", timestamp: "1790000000" },
      warnings: [],
      upgradeHandler: ADDRESS,
      securityCouncil: { address: ADDRESS, members: [] },
      guardians: { address: ADDRESS, members: [] },
      emergencyUpgradeBoard: { address: ADDRESS, zkFoundation: ADDRESS },
    },
    logHistory,
    safeApi: { url: null, withKey: false, quota: { remaining: null, limit: null } },
    l2RpcConfigured: true,
    clientVersion: "test",
    sync: {
      index,
      cache: { state: "verified", file: null, savedAt: null, sizeBytes: null, detail: null },
    },
  } as unknown as OkStatus;
}

const fetch = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusRevalidation();
  router.revalidate.mockReset();
  fetch.mockReset();
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const toggle = { defaultShouldRevalidate: true };

it("reads the root status once when a beat shows the index finished, and shows the log-history banner it brings", async () => {
  const backfilling = status({ ...READY, state: "backfilling", chunks: { done: 40, total: 435 } });
  const view = render(shell(backfilling));
  expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 9%");
  expect(shouldRevalidateRoot(toggle)).toBe(false); // the status just landed

  view.rerender(
    shell(backfilling, { ...READY, state: "backfilling", chunks: { done: 300, total: 435 } })
  );
  expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 68%");
  expect(router.revalidate).not.toHaveBeenCalled();
  view.rerender(shell(backfilling, READY));
  expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
  expect(router.revalidate).toHaveBeenCalledTimes(1);
  // That revalidation (and any navigation until the new status lands) reads the root.
  expect(shouldRevalidateRoot(toggle)).toBe(true);
  expect(shouldRevalidateRoot(toggle)).toBe(true);

  // The root's new status: the index check found the canary missing.
  view.rerender(shell(status(READY, { status: "missing", blockNumber: "20500000" }), READY));
  expect(screen.getByText("Your RPC may not serve old logs.")).toBeInTheDocument();
  expect(shouldRevalidateRoot(toggle)).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).not.toHaveBeenCalled();
  expect(router.revalidate).toHaveBeenCalledTimes(1);
});

it("does the same when the root status was read before the backfill started (a settings save)", async () => {
  const idle = status({ ...READY, state: "idle", chunks: { done: 0, total: 0 } });
  const view = render(shell(idle));
  view.rerender(shell(idle, { ...READY, state: "idle", chunks: { done: 0, total: 0 } }));
  view.rerender(shell(idle, { ...READY, state: "backfilling" }));
  expect(router.revalidate).not.toHaveBeenCalled();
  view.rerender(shell(idle, READY));
  expect(fetch).not.toHaveBeenCalled();
  expect(router.revalidate).toHaveBeenCalledTimes(1);
});

it("asks nothing when the root status already had the index ready", async () => {
  render(<AppShell status={status(READY)}>page</AppShell>);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).not.toHaveBeenCalled();
  expect(router.revalidate).not.toHaveBeenCalled();
});

it("notes every new root status as landed, and only new ones", () => {
  const first = status(READY);
  const view = render(<AppShell status={first}>page</AppShell>);
  vi.setSystemTime(Date.now() + 31_000);
  view.rerender(<AppShell status={first}>page</AppShell>);
  expect(shouldRevalidateRoot(toggle)).toBe(true);
  view.rerender(<AppShell status={status(READY)}>page</AppShell>);
  expect(shouldRevalidateRoot(toggle)).toBe(false);
});

it("shows what live updates do in a floating note outside the header: the header and the page never move for it, nor does it cover the navigation", () => {
  for (const state of [
    { updating: true },
    { catchingUp: true },
    { away: true },
    { failing: true, lastBeatAt: Date.now() - 90_000 },
  ]) {
    const view = render(
      <LiveStateProvider value={{ ...INITIAL_LIVE, ...state }}>
        <AppShell status={status(READY)}>page</AppShell>
      </LiveStateProvider>
    );
    const note = screen.getByTestId("live-note");
    expect(note.closest("header")).toBeNull();
    const floating = note.parentElement as HTMLElement;
    expect(floating.className).toContain("fixed");
    expect(floating.className).toContain("pointer-events-none");
    const header = document.querySelector("header") as HTMLElement;
    expect(header.textContent).not.toMatch(/Updating|Checking for changes|Updates paused/);
    view.unmount();
  }
  render(<AppShell status={status(READY)}>page</AppShell>);
  expect(screen.queryByTestId("live-note")).not.toBeInTheDocument();
});

it("names the served head only over a status read there too; otherwise the status's own block, with a banner saying it was not re-read", () => {
  const root = status(READY);
  const own = root.governance.latestBlock;
  const served = { number: "21000070", hash: "0x01", timestamp: "1790000072" };
  const pill = () => screen.getByTestId("block-age").getAttribute("title") ?? "";
  // The status was read again at the served head: the header names that head.
  const current = render(
    <LiveStateProvider
      value={{
        ...INITIAL_LIVE,
        head: served,
        notedAt: { status: { rev: "1", block: served.number } },
      }}
    >
      <AppShell status={root}>page</AppShell>
    </LiveStateProvider>
  );
  expect(pill()).toContain(`Block ${served.number}`);
  expect(screen.queryByTestId("status-not-reread")).not.toBeInTheDocument();
  expect(screen.getByTestId("network-dot")).toHaveClass("bg-green-500");
  current.unmount();
  // Not read again since its own block: the header names that block (its age grows), never the
  // newer head over it, and a banner says the trust checks are as of it.
  const behind = render(
    <LiveStateProvider
      value={{
        ...INITIAL_LIVE,
        head: served,
        notedAt: { status: { rev: "1", block: own.number } },
      }}
    >
      <AppShell status={root}>page</AppShell>
    </LiveStateProvider>
  );
  expect(pill()).toContain(`Block ${own.number}`);
  expect(screen.getByTestId("status-not-reread")).toHaveTextContent(
    "Status not re-read since block #21,000,064."
  );
  expect(screen.getByTestId("status-not-reread")).toHaveTextContent("#21,000,070");
  // Never in a passing colour over it.
  expect(screen.getByTestId("network-dot")).not.toHaveClass("bg-green-500");
  expect(screen.getByTestId("network-pill")).toHaveAttribute("data-stale", "true");
  behind.unmount();
  // Before the first beat, or for a status the beats do not name (a reload on its way): its own.
  render(
    <LiveStateProvider value={{ ...INITIAL_LIVE, head: served }}>
      <AppShell status={root}>page</AppShell>
    </LiveStateProvider>
  );
  expect(pill()).toContain(`Block ${own.number}`);
  expect(screen.queryByTestId("status-not-reread")).not.toBeInTheDocument();
});
