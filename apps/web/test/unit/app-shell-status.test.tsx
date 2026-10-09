import type { OkStatus } from "@/components/governance-context";
import { resetStatusRevalidation, shouldRevalidateRoot } from "@/utils/revalidation";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The app shell with the log index still backfilling when the root status was read. The root is
// not read again on its own, so when the index's poll finds it finished, the shell asks for the
// root status once: it carries the log-history check against the index ("Your RPC may not serve
// old logs"), which had no opinion while the index was backfilling.

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
    sync: { index },
  } as unknown as OkStatus;
}

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) });
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
// One poll per act: React renders (and schedules the next poll) when the act ends.
const pollOnce = () => act(() => vi.advanceTimersByTimeAsync(2_000));

it("reads the root status once when the index finishes, and shows the log-history banner it brings", async () => {
  fetch.mockReturnValue(answer(status(READY, { status: "missing", blockNumber: "20500000" })));
  const backfilling = status({ ...READY, state: "backfilling", chunks: { done: 40, total: 435 } });
  const view = render(<AppShell status={backfilling}>page</AppShell>);
  expect(screen.getByTestId("index-progress")).toHaveTextContent("Indexing 9%");
  expect(shouldRevalidateRoot(toggle)).toBe(false); // the status just landed

  await pollOnce();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("index-progress")).not.toBeInTheDocument();
  expect(router.revalidate).toHaveBeenCalledTimes(1);
  // That revalidation (and any navigation until the new status lands) reads the root.
  expect(shouldRevalidateRoot(toggle)).toBe(true);
  expect(shouldRevalidateRoot(toggle)).toBe(true);

  // The root's new status: the index check found the canary missing.
  view.rerender(
    <AppShell status={status(READY, { status: "missing", blockNumber: "20500000" })}>page</AppShell>
  );
  expect(screen.getByText("Your RPC may not serve old logs.")).toBeInTheDocument();
  expect(shouldRevalidateRoot(toggle)).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(router.revalidate).toHaveBeenCalledTimes(1);
});

it("does the same when the root status was read before the backfill started (a settings save)", async () => {
  fetch
    .mockReturnValueOnce(answer(status({ ...READY, state: "idle", chunks: { done: 0, total: 0 } })))
    .mockReturnValueOnce(answer(status({ ...READY, state: "backfilling" })))
    .mockReturnValueOnce(answer(status(READY)));
  render(<AppShell status={status({ ...READY, state: "idle" })}>page</AppShell>);
  await pollOnce();
  await pollOnce();
  expect(router.revalidate).not.toHaveBeenCalled();
  await pollOnce();
  expect(fetch).toHaveBeenCalledTimes(3);
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
