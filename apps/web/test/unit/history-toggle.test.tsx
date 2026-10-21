import { HistoryToggle, PendingRegion, useNavigatingTo } from "@/components/history-toggle";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { beforeEach, expect, it, vi } from "vitest";

type Navigation = { state: string; location?: { pathname: string; search: string } };
const router = vi.hoisted(() => ({ navigation: { state: "idle" } as Navigation }));
vi.mock("@remix-run/react", () => ({
  useNavigation: () => router.navigation,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  router.navigation = { state: "idle" };
});

const FULL = "/app/proposals?history=all";

function Page({ to }: { to: string }) {
  const pending = useNavigatingTo(to);
  return (
    <>
      <HistoryToggle to={to} pendingLabel="Loading full history…">
        Show full history
      </HistoryToggle>
      <PendingRegion pending={pending}>
        <p>Finished upgrades</p>
      </PendingRegion>
    </>
  );
}

it("is a plain link while nothing is loading", () => {
  render(<Page to={FULL} />);
  const link = screen.getByRole("link", { name: "Show full history" });
  expect(link).toHaveAttribute("href", FULL);
  expect(link).not.toHaveAttribute("aria-busy");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("Finished upgrades").parentElement).not.toHaveAttribute("aria-busy");
});

it("shows that the other history is loading while its navigation is in flight", () => {
  router.navigation = {
    state: "loading",
    location: { pathname: "/app/proposals", search: "?history=all" },
  };
  render(<Page to={FULL} />);
  const link = screen.getByTestId("history-toggle");
  expect(link).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Loading full history…");
  const region = screen.getByText("Finished upgrades").parentElement;
  expect(region).toHaveAttribute("aria-busy", "true");
  expect(region).toHaveClass("opacity-60");
});

it.each([
  ["another page", { pathname: "/app/emergency", search: "" }],
  ["the same page without the toggle's search", { pathname: "/app/proposals", search: "" }],
  ["another search", { pathname: "/app/proposals", search: "?sig=0x01:0x02" }],
])("stays a plain link while %s loads", (_name, location) => {
  router.navigation = { state: "loading", location };
  render(<Page to={FULL} />);
  expect(screen.getByRole("link", { name: "Show full history" })).not.toHaveAttribute("aria-busy");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("works for the button variant and the way back to recent history", () => {
  router.navigation = { state: "loading", location: { pathname: "/app/emergency", search: "" } };
  render(
    <HistoryToggle to="/app/emergency" variant="button" pendingLabel="Loading recent executions…">
      Show recent executions
    </HistoryToggle>
  );
  expect(screen.getByTestId("history-toggle")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Loading recent executions…");
});
