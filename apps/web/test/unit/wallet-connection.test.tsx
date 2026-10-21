import { render, renderHook, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supportsDesktopWallet } from "@/common/walletconnect";
import ConnectButton, { useConnectWallet } from "@/components/connect-button";

// Isolate connector selection and explicit user actions; no extension or relay is contacted.
const wallet = vi.hoisted(() => ({ connectors: [] as { id: string }[], connect: vi.fn() }));
vi.mock("wagmi", () => ({
  useConnect: () => ({ ...wallet, isPending: false }),
  useAccount: () => ({}),
  useConfig: () => ({ chains: [{ id: 11155111, name: "Sepolia", testnet: true }] }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
}));
vi.mock("@/components/governance-context", () => ({ useStatusIfRead: () => null }));
vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: { Custom: ({ children }: any) => children({ mounted: true }) },
}));

beforeEach(() => {
  wallet.connect.mockReset();
  wallet.connectors = [];
});
describe("Safe-first wallet connection", () => {
  it("uses WalletConnect by default and keeps desktop MetaMask explicitly selectable", () => {
    wallet.connectors = [{ id: "walletConnect" }, { id: "metaMask" }, { id: "io.metamask" }];
    const { result } = renderHook(useConnectWallet);
    expect(wallet.connect).not.toHaveBeenCalled();
    result.current.connect?.();
    expect(wallet.connect).toHaveBeenCalledWith({ connector: wallet.connectors[0] });
    result.current.connectMetaMask?.();
    expect(wallet.connect).toHaveBeenLastCalledWith({ connector: wallet.connectors[2] });
    result.current.connectWalletConnect?.();
    expect(wallet.connect).toHaveBeenLastCalledWith({ connector: wallet.connectors[0] });
  });
  it("uses the legacy MetaMask provider without a WalletConnect project", () => {
    wallet.connectors = [{ id: "metaMask" }];
    render(<ConnectButton />);
    expect(wallet.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desktop MetaMask" }));
    expect(wallet.connect).toHaveBeenCalledWith({ connector: wallet.connectors[0] });
  });
  it("connects a member Safe through WalletConnect without an injected provider", () => {
    wallet.connectors = [{ id: "walletConnect" }];
    const { result } = renderHook(useConnectWallet);
    expect(result.current.connectMetaMask).toBeUndefined();
    result.current.connect?.();
    expect(wallet.connect).toHaveBeenCalledWith({ connector: wallet.connectors[0] });
  });
  it("does not open a request without a connector", () => {
    const { result } = renderHook(useConnectWallet);
    expect(result.current.connect).toBeUndefined();
    expect(wallet.connect).not.toHaveBeenCalled();
  });
});

it("disables extension transport for serverless files", () => {
  expect(supportsDesktopWallet("file:")).toBe(false);
  expect(supportsDesktopWallet(undefined)).toBe(false);
  expect(supportsDesktopWallet("http:")).toBe(true);
  expect(supportsDesktopWallet("https:")).toBe(true);
});

it("does not replace a missing Safe connector with an EOA", () => {
  wallet.connectors = [{ id: "metaMask" }];
  const { result } = renderHook(useConnectWallet);
  expect(result.current.connect).toBeUndefined();
  expect(result.current.connectWalletConnect).toBeUndefined();
  expect(result.current.connectMetaMask).toBeDefined();
  expect(wallet.connect).not.toHaveBeenCalled();
});
