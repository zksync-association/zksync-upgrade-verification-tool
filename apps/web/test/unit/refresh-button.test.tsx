import {
  noteStatusLanded,
  resetStatusRevalidation,
  shouldRevalidateRoot,
} from "@/utils/revalidation";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { beforeEach, expect, it, vi } from "vitest";

// The fetcher as the router drives it through Refresh: submitting (the POST), loading (the
// router's automatic revalidation of every loader on the page, with the action's data), idle.
const router = vi.hoisted(() => ({
  fetcher: { state: "idle", data: undefined as { refreshed: boolean } | undefined },
  submit: vi.fn(),
  revalidate: vi.fn(),
  useRevalidator: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@remix-run/react", () => ({
  useFetcher: () => ({ ...router.fetcher, submit: router.submit }),
  useRevalidator: () => {
    router.useRevalidator();
    return { revalidate: router.revalidate, state: "idle" };
  },
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  NavLink: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("react-hot-toast", () => ({ toast }));
vi.mock("@/components/connect-button", async () => {
  const { createContext } = await import("react");
  return { default: () => null, WalletOfferContext: createContext(() => {}) };
});

const { RefreshButton } = await import("@/components/app-shell");

beforeEach(() => {
  resetStatusRevalidation();
  noteStatusLanded({});
  router.fetcher = { state: "idle", data: undefined };
  router.submit.mockReset();
  router.revalidate.mockReset();
  router.useRevalidator.mockReset();
  toast.mockReset();
});

function drive(view: ReturnType<typeof render>, state: string, data?: { refreshed: boolean }) {
  router.fetcher = { state, data };
  view.rerender(<RefreshButton />);
}

it("makes one revalidation pass: the router's own after the POST, none of its own", () => {
  const view = render(<RefreshButton />);
  const button = screen.getByRole("button", { name: "Refresh data" });
  fireEvent.click(button);
  expect(router.submit).toHaveBeenCalledTimes(1);
  expect(router.submit).toHaveBeenCalledWith(null, {
    method: "POST",
    action: "/resources/refresh",
  });

  // That POST makes the router revalidate, root included (the status is read again).
  expect(
    shouldRevalidateRoot({
      formMethod: "POST",
      formAction: "/resources/refresh",
      defaultShouldRevalidate: true,
    })
  ).toBe(true);
  // The click also asked for the status: a navigation that cuts that reload short reads it too,
  // until the new status has landed.
  const pathnameNavigation = { defaultShouldRevalidate: false };
  expect(shouldRevalidateRoot(pathnameNavigation)).toBe(true);
  noteStatusLanded({});
  expect(shouldRevalidateRoot(pathnameNavigation)).toBe(false);

  drive(view, "submitting");
  expect(button).toBeDisabled();
  // The router's pass: still busy until the page data is back.
  const data = { refreshed: true };
  drive(view, "loading", data);
  expect(button).toBeDisabled();
  drive(view, "idle", data);
  expect(button).toBeEnabled();
  view.rerender(<RefreshButton />);

  expect(router.revalidate).not.toHaveBeenCalled();
  expect(router.useRevalidator).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

it("says once when Safe data was refreshed too recently, still without a second pass", () => {
  const view = render(<RefreshButton />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  const data = { refreshed: false };
  drive(view, "submitting");
  drive(view, "loading", data);
  expect(toast).not.toHaveBeenCalled();
  drive(view, "idle", data);
  drive(view, "idle", data);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("Refreshed less than 10 s ago; showing cached Safe data.");
  expect(router.revalidate).not.toHaveBeenCalled();
});
