import Navbar from "@/components/navbar";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import "@testing-library/jest-dom";
import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useAccount } from "wagmi";
import "@testing-library/jest-dom";
import useUser from "@/components/hooks/use-user";

vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

vi.mock("@remix-run/react", () => ({
  useRouteLoaderData: vi.fn(),
  useFetcher: vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
}));

vi.mock("@/components/connect-button", () => ({
  // biome-ignore lint/a11y/useButtonType: test
  default: () => <button>Mocked Connect Button</button>,
}));

vi.mock("@/components/hooks/use-user", () => ({
  default: vi.fn(),
}));

const mockedUseRouteLoaderData = vi.mocked(useRouteLoaderData);
const mockedUseAccount = vi.mocked(useAccount);
const mockedUseUser = vi.mocked(useUser);
const mockedUseFetcher = vi.mocked(useFetcher);

describe("Navbar", () => {
  beforeEach(() => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    mockedUseAccount.mockReturnValue({
      isConnected: true,
      address: "0x32c5409213853d317558b26384b4bF8342060E3d",
    } as any);
    mockedUseUser.mockReturnValue({
      role: "guardian",
      address: "0x32c5409213853d317558b26384b4bF8342060E3d",
    });
    mockedUseFetcher.mockReturnValue({ state: "idle" } as any);
  });

  it("renders Navbar with Logo and correct link", async () => {
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

  it("renders Navbar with Logo and correct link", () => {
    render(<Navbar />);

    const logoLink = screen.getByRole("link");
    expect(logoLink).toBeInTheDocument();
    expect(logoLink).toHaveAttribute("href", "/");
  });

  it("renders ConnectButton", () => {
    render(<Navbar />);

    const connectButton = screen.getByText("Mocked Connect Button");
    expect(connectButton).toBeInTheDocument();
  });

  it("renders Guardian role button when role is guardian", () => {
    mockedUseUser.mockReturnValue({
      role: "guardian",
      address: "0x32c5409213853d317558b26384b4bF8342060E3d",
    });
    render(<Navbar />);

    const guardianButton = screen.getByRole("button", { name: /guardian/i });
    expect(guardianButton).toBeInTheDocument();
    expect(guardianButton).toBeDisabled();
  });

  it("renders Security Council role button when role is securityCouncil", () => {
    mockedUseUser.mockReturnValue({
      role: "securityCouncil",
      address: "0x32c5409213853d317558b26384b4bF8342060E3d",
    });
    render(<Navbar />);

    const securityCouncilButton = screen.getByRole("button", { name: /security council/i });
    expect(securityCouncilButton).toBeInTheDocument();
    expect(securityCouncilButton).toBeDisabled();
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
