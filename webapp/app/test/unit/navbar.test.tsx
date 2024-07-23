import Navbar from "@/components/navbar";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import "@testing-library/jest-dom";

vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

describe("Navbar", () => {
  it("renders Navbar with Logo and correct link", async () => {
    render(<Navbar environment={"production"} />);

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
    const { rerender } = render(<Navbar environment="development" />);

    let envBadge: HTMLElement | null = screen.getByText("Dev");
    expect(envBadge).toBeInTheDocument();

    rerender(<Navbar environment="production" />);
    envBadge = screen.queryByText("production");
    expect(envBadge).not.toBeInTheDocument();
  });
});
