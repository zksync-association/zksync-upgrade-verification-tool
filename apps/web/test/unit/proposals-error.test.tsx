import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import "@testing-library/jest-dom";

const data = vi.hoisted(() => ({ list: Promise.resolve() as Promise<unknown> }));
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

it("keeps the page and recovery controls visible when deferred discovery fails", async () => {
  data.list = Promise.reject(new Error("RPC log history unavailable"));
  render(<Proposals />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The proposal list could not be loaded"
  );
  expect(screen.getByRole("heading", { name: "Protocol upgrades" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/settings");
});
