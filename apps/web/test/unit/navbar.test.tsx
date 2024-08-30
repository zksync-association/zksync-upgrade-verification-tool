import Navbar from "@/components/navbar";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import "@testing-library/jest-dom";
import { useRouteLoaderData } from "@remix-run/react";

vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

vi.mock("@remix-run/react", () => ({
  useRouteLoaderData: vi.fn(),
}));

const mockedUseRouteLoaderData = vi.mocked(useRouteLoaderData);

describe("Navbar", () => {
  it("renders Navbar with Logo and correct link", async () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<Navbar />);

    const logo = await screen.findByAltText("Zksync Logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", expect.stringContaining("zksync.svg"));

    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");

    expect(link).toContainElement(logo);

    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
    expect(header).toContainElement(screen.getByRole("navigation"));
  });

  it("renders EnvBadge for development environment but not for production", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "development" } });
    const { rerender } = render(<Navbar />);

    let envBadge: HTMLElement | null = screen.getByText("Dev");
    expect(envBadge).toBeInTheDocument();

    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    rerender(<Navbar />);
    envBadge = screen.queryByText("production");
    expect(envBadge).not.toBeInTheDocument();
  });
});
