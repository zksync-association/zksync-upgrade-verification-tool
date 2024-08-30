import NavbarWithUser from "@/components/navbar-with-user";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { WagmiProvider } from "wagmi";
import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import "@testing-library/jest-dom";
import { useRouteLoaderData } from "@remix-run/react";

vi.mock("@/components/connect-button", () => ({
  // biome-ignore lint/a11y/useButtonType: test
  default: () => <button>Mocked Connect Button</button>,
}));

// Mock the $path function
vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

// Create a mock Wagmi config
const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});

// Create a wrapper component with all necessary providers
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient();
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
};

vi.mock("@remix-run/react", () => ({
  useRouteLoaderData: vi.fn(),
}));

const mockedUseRouteLoaderData = vi.mocked(useRouteLoaderData);

describe("NavbarWithUser", () => {
  it("renders NavbarWithUser with Logo and correct link", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<NavbarWithUser role={null} />, { wrapper });

    const logoLink = screen.getByRole("link");
    expect(logoLink).toBeInTheDocument();
    expect(logoLink).toHaveAttribute("href", "/");
  });

  it("renders ConnectButton", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<NavbarWithUser role={null} />, { wrapper });

    const connectButton = screen.getByText("Mocked Connect Button");
    expect(connectButton).toBeInTheDocument();
  });

  it("renders Guardian role button when role is guardian", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<NavbarWithUser role="guardian" />, { wrapper });

    const guardianButton = screen.getByRole("button", { name: /guardian/i });
    expect(guardianButton).toBeInTheDocument();
    expect(guardianButton).toBeDisabled();
  });

  it("renders Security Council role button when role is securityCouncil", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<NavbarWithUser role="securityCouncil" />, { wrapper });

    const securityCouncilButton = screen.getByRole("button", { name: /security council/i });
    expect(securityCouncilButton).toBeInTheDocument();
    expect(securityCouncilButton).toBeDisabled();
  });

  it("does not render role button when role is null", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    render(<NavbarWithUser role={null} />, { wrapper });

    const guardianButton = screen.queryByRole("button", { name: /guardian/i });
    const securityCouncilButton = screen.queryByRole("button", { name: /security council/i });
    expect(guardianButton).not.toBeInTheDocument();
    expect(securityCouncilButton).not.toBeInTheDocument();
  });

  it("renders EnvBadge for development environment but not for production", () => {
    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "development" } });
    const { rerender } = render(<NavbarWithUser role={null} />, {
      wrapper,
    });

    let envBadge: HTMLElement | null = screen.getByText("Dev");
    expect(envBadge).toBeInTheDocument();

    mockedUseRouteLoaderData.mockReturnValue({ env: { NODE_ENV: "production" } });
    rerender(<NavbarWithUser role={null} />);
    envBadge = screen.queryByText("production");
    expect(envBadge).not.toBeInTheDocument();
  });
});
