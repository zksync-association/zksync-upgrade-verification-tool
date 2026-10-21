import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SAFE_OWNER_APPROVAL, safeOwnerMessageCall } from "@/common/safe-owner-approval";
import type { SignAction } from "@/components/verification/your-signature";
import type { Address, Hex } from "viem";
import { SafeOwnerApprovals } from "@/components/verification/safe-owner-approvals";

// Isolate RPC and wallet boundaries. Rendering/review is real; no signing request leaves tests.
const state = vi.hoisted(() => ({
  status: {} as any,
  account: {} as any,
  blocked: null as any,
  wallet: {} as any,
  connect: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => state.account,
  useWalletClient: () => ({ data: state.wallet }),
}));
vi.mock("@/components/governance-context", () => ({ useStatusIfRead: () => state.status }));
vi.mock("@/components/connect-button", () => ({
  useConnectWallet: () => ({ connectMetaMask: state.connect }),
}));
vi.mock("@/components/presence", () => ({
  useHoldUpdates: () => {},
  usePresence: () => ({ reload: state.reload }),
}));
vi.mock("@/components/verification/content-currency", () => ({
  usePageNotCurrent: () => state.blocked,
}));
vi.mock("@/components/hex", () => ({
  AddressLink: ({ address }: any) => <span>{address}</span>,
  Hash: ({ value }: any) => <span>{value}</span>,
  TxLink: ({ hash }: any) => <span>{hash}</span>,
  CopyButton: () => null,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

const safe = "0x134Cf18eC62e2D42c708A8b6E7476bF4d15E9532" as Address;
const owner = "0xeC6A5c568A59C0858ed6680A6862d64aA2DA8D4b" as Address;
const digest = `0x${"ab".repeat(32)}` as Hex;
const hash = `0x${"cd".repeat(32)}` as Hex;
const plan = {
  ...safeOwnerMessageCall(safe, owner, digest),
  chainId: 11155111,
  safe,
  owner,
  digest,
  value: "0",
  alreadyApproved: false,
  gasLimit: "1000000",
  checkedAtBlock: "100",
};
const action = () =>
  ({
    key: "securityCouncil",
    title: "Council approval",
    state: { status: "open" },
    set: {
      action: "ApproveUpgradeSecurityCouncil",
      threshold: 4,
      hashes: { digest },
      typedData: { message: { id: digest } },
      members: [
        {
          member: safe,
          status: "missing",
          safe: { version: "1.3.0", threshold: 1, owners: [owner] },
        },
      ],
    },
  }) as unknown as SignAction;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  state.connect.mockReset();
  state.reload.mockReset();
  state.status = {
    governance: {
      upgradeHandler: SAFE_OWNER_APPROVAL.handler,
      network: { chainId: 11155111, overrides: [] },
      warnings: [],
    },
    logHistory: { status: "ok" },
    sync: { cache: { state: "ready" } },
  };
  state.account = { address: owner, connector: { id: "io.metamask" } };
  state.blocked = null;
  state.wallet = {
    chain: { id: 11155111 },
    getChainId: vi.fn(async () => 11155111),
    getAddresses: vi.fn(async () => [owner]),
    sendTransaction: vi.fn(async () => hash),
  };
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ plan }) }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: async (_name: string, _options: unknown, _callback: any) => _callback({}) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const review = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
  await screen.findByRole("button", { name: "Send to MetaMask" });
};

it("shows an explicit owner connection option without contacting a wallet on render", () => {
  state.account = { address: safe, connector: { id: "walletConnect" } };
  render(<SafeOwnerApprovals actions={[action()]} />);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(state.wallet.sendTransaction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect MetaMask owner" }));
  expect(state.connect).toHaveBeenCalledOnce();
  expect(
    (screen.getByRole("button", { name: "Review approval" }) as HTMLButtonElement).disabled
  ).toBe(true);
});
it("reviews first, rechecks before sending, and persists one pending request", async () => {
  render(<SafeOwnerApprovals actions={[action()]} />);
  await review();
  expect(state.wallet.sendTransaction).not.toHaveBeenCalled();
  expect(screen.getByText(plan.safeMessageHash)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
  await waitFor(() => expect(state.wallet.sendTransaction).toHaveBeenCalledOnce());
  expect(state.wallet.sendTransaction).toHaveBeenCalledWith({
    account: owner,
    chain: state.wallet.chain,
    to: safe,
    data: plan.data,
    value: 0n,
    gas: 1_000_000n,
  });
  await screen.findByRole("button", { name: "Check approval / retry if failed" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(localStorage.key(0) ?? "")).toContain(hash);
  fireEvent.click(screen.getByRole("button", { name: "Check approval / retry if failed" }));
  await screen.findByRole("alert");
  expect(state.wallet.sendTransaction).toHaveBeenCalledOnce();
});
it.each(["wrong chain", "changed owner", "changed calldata"])(
  "blocks %s before the wallet send",
  async (_case) => {
    render(<SafeOwnerApprovals actions={[action()]} />);
    await review();
    if (_case === "wrong chain") state.wallet.getChainId.mockResolvedValue(1);
    if (_case === "changed owner") state.wallet.getAddresses.mockResolvedValue([safe]);
    if (_case === "changed calldata")
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ plan: { ...plan, data: "0x1234" } }),
      });
    fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
    await screen.findByRole("alert");
    expect(state.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  }
);
it("keeps an ambiguous wallet submission blocked across remounts", async () => {
  state.wallet.sendTransaction.mockRejectedValue(new Error("Wallet disconnected"));
  const view = render(<SafeOwnerApprovals actions={[action()]} />);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
  await screen.findByRole("alert");
  view.unmount();
  render(<SafeOwnerApprovals actions={[action()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Check approval / retry if failed" }));
  await screen.findByRole("alert");
  expect(state.wallet.sendTransaction).toHaveBeenCalledOnce();
});
it("leaves a rejected wallet request retryable", async () => {
  state.wallet.sendTransaction.mockRejectedValue(
    Object.assign(new Error("Rejected"), { code: 4001 })
  );
  render(<SafeOwnerApprovals actions={[action()]} />);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
  await screen.findByRole("alert");
  expect(localStorage.length).toBe(0);
});
it("refreshes an already recorded approval without submitting it again", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ plan: { ...plan, alreadyApproved: true } }),
  });
  render(<SafeOwnerApprovals actions={[action()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
  await waitFor(() => expect(state.reload).toHaveBeenCalledOnce());
  expect(state.wallet.sendTransaction).not.toHaveBeenCalled();
});
it("blocks stale governance and hides the helper on mainnet", () => {
  state.blocked = { reason: "Waiting for current block" };
  const view = render(<SafeOwnerApprovals actions={[action()]} />);
  expect(
    (screen.getByRole("button", { name: "Review approval" }) as HTMLButtonElement).disabled
  ).toBe(true);
  state.status.governance.network.chainId = 1;
  view.rerender(<SafeOwnerApprovals actions={[action()]} />);
  expect(screen.queryByTestId("safe-owner-approvals")).toBeNull();
});

it("offers a reviewed retry only after the matching receipt proves the earlier send reverted", async () => {
  render(<SafeOwnerApprovals actions={[action()]} />);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
  await screen.findByRole("button", { name: "Check approval / retry if failed" });
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ plan: { ...plan, previousSubmission: { hash, status: "reverted" } } }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Check approval / retry if failed" }));
  await screen.findByText(/previous transaction reverted on-chain/i);
  expect(state.wallet.sendTransaction).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(`hash=${hash}`);
  fireEvent.click(screen.getByRole("button", { name: "Send to MetaMask" }));
  await waitFor(() => expect(state.wallet.sendTransaction).toHaveBeenCalledTimes(2));
});
