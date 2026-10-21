import { render, renderHook, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
describe("desktop wallet connection", () => {
  it("prefers discovered MetaMask over the legacy provider and WalletConnect", () => {
    wallet.connectors = [{ id: "walletConnect" }, { id: "metaMask" }, { id: "io.metamask" }];
    const { result } = renderHook(useConnectWallet);
    expect(wallet.connect).not.toHaveBeenCalled();
    result.current.connect?.();
    expect(wallet.connect).toHaveBeenCalledWith({ connector: wallet.connectors[2] });
    result.current.connectWalletConnect?.();
    expect(wallet.connect).toHaveBeenLastCalledWith({ connector: wallet.connectors[0] });
  });
  it("uses the legacy MetaMask provider without a WalletConnect project", () => {
    wallet.connectors = [{ id: "metaMask" }];
    render(<ConnectButton />);
    expect(wallet.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));
    expect(wallet.connect).toHaveBeenCalledWith({ connector: wallet.connectors[0] });
  });
  it("retains WalletConnect as a fallback", () => {
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
