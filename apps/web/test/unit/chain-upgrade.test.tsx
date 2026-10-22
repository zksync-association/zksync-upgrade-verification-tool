import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ChainUpgradePage from "@/routes/app/chain-upgrade/_route";
import fixture from "../fixtures/chain-upgrade.json";
const ui = vi.hoisted(() => ({
  account: {} as any,
  wallet: {} as any,
  connect: vi.fn(),
  remote: {} as any,
  plan: {} as any,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ui.account,
  useWalletClient: () => ({ data: ui.wallet }),
}));
vi.mock("@/components/connect-button", () => ({
  useConnectWallet: () => ({ connectMetaMask: ui.connect }),
}));
vi.mock("@/components/presence", () => ({ useHoldUpdates: () => {} }));
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
const hash = `0x${"ab".repeat(32)}`;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  ui.connect.mockReset();
  ui.remote = { ...fixture.state, clock: "1792620816" };
  ui.account = { address: fixture.state.owner };
  ui.plan = {
    action: "timestamp",
    chainId: 11155111,
    owner: fixture.state.owner,
    to: fixture.state.admin,
    data: "0x1234",
    value: "0",
    gasLimit: "800000",
    timestamp: "1792620816",
    state: ui.remote,
  };
  ui.wallet = {
    chain: { id: 11155111 },
    getChainId: vi.fn(async () => 11155111),
    getAddresses: vi.fn(async () => [fixture.state.owner]),
    sendTransaction: vi.fn(async () => hash),
  };
  request = vi.fn(async (_url: string) => {
    const q = new URL(_url, "http://localhost").searchParams;
    return {
      ok: true,
      json: async () =>
        q.has("action")
          ? { state: ui.remote, plan: { ...ui.plan, action: q.get("action") } }
          : { state: ui.remote },
    };
  });
  vi.stubGlobal("fetch", request);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: async (_name: string, _options: any, _callback: any) => _callback({}) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const load = async () => {
  render(<ChainUpgradePage />);
  await screen.findByText("v0.31.1");
};
const reviewTimestamp = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Use current chain time" }));
  fireEvent.click(screen.getByRole("button", { name: "Review timestamp" }));
  await screen.findByRole("button", { name: "Send to wallet" });
};
it("reads the registered chain and disables execution until a timestamp is recorded", async () => {
  await load();
  expect(screen.getByText("v0.33.0")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Review chain upgrade" }) as HTMLButtonElement).disabled
  ).toBe(true);
  expect(ui.wallet.sendTransaction).not.toHaveBeenCalled();
});
it("reviews, rechecks and submits only the exact owner-authorized timestamp call", async () => {
  await load();
  await reviewTimestamp();
  expect(ui.wallet.sendTransaction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
  await waitFor(() => expect(ui.wallet.sendTransaction).toHaveBeenCalledOnce());
  expect(ui.wallet.sendTransaction).toHaveBeenCalledWith({
    account: fixture.state.owner,
    chain: ui.wallet.chain,
    to: fixture.state.admin,
    data: "0x1234",
    value: 0n,
    gas: 800000n,
  });
  await screen.findByText(hash);
  expect(localStorage.getItem(localStorage.key(0) ?? "")).toContain(hash);
  fireEvent.click(screen.getByRole("button", { name: "Check timestamp / retry if failed" }));
  await screen.findByRole("alert");
  expect(ui.wallet.sendTransaction).toHaveBeenCalledOnce();
});
it.each(["wrong chain", "changed owner", "changed call"])(
  "blocks %s before opening the send",
  async (_case) => {
    await load();
    await reviewTimestamp();
    if (_case === "wrong chain") ui.wallet.getChainId.mockResolvedValue(1);
    if (_case === "changed owner") ui.wallet.getAddresses.mockResolvedValue([fixture.state.admin]);
    if (_case === "changed call") ui.plan = { ...ui.plan, data: "0xabcd" };
    fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
    await screen.findByRole("alert");
    expect(ui.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  }
);
it("keeps an ambiguous submission blocked after reloading the page", async () => {
  ui.wallet.sendTransaction.mockRejectedValue(new Error("Wallet disconnected"));
  await load();
  await reviewTimestamp();
  fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
  await screen.findByRole("alert");
  cleanup();
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Check timestamp / retry if failed" }));
  await screen.findByRole("alert");
  expect(ui.wallet.sendTransaction).toHaveBeenCalledOnce();
});
it("opens a new explicit review when the matching previous receipt is reverted", async () => {
  await load();
  await reviewTimestamp();
  fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
  await screen.findByText(hash);
  ui.plan = { ...ui.plan, previousSubmission: { hash, status: "reverted" } };
  fireEvent.click(screen.getByRole("button", { name: "Check timestamp / retry if failed" }));
  await screen.findByRole("button", { name: "Retry in wallet" });
  expect(ui.wallet.sendTransaction).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry in wallet" }));
  await waitFor(() => expect(ui.wallet.sendTransaction).toHaveBeenCalledTimes(2));
});
it("waits on L1 chain time for an already scheduled upgrade", async () => {
  ui.remote.timestamp = "1792620817";
  await load();
  expect(
    (screen.getByRole("button", { name: "Review chain upgrade" }) as HTMLButtonElement).disabled
  ).toBe(true);
});
it("permits reviewing execution once the on-chain scheduled time has arrived", async () => {
  ui.remote.timestamp = "1792620816";
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Review chain upgrade" }));
  await screen.findByRole("button", { name: "Send to wallet" });
  expect(ui.wallet.sendTransaction).not.toHaveBeenCalled();
});
it("shows a completed chain and offers no duplicate upgrade", async () => {
  ui.remote.currentVersion = ui.remote.targetVersion;
  ui.remote.completed = true;
  render(<ChainUpgradePage />);
  await screen.findByText("Chain upgraded to v0.33.0");
  expect(screen.queryByRole("button", { name: "Review chain upgrade" })).toBeNull();
});
it("requires the actual chain owner rather than an unrelated connected account", async () => {
  ui.account.address = fixture.state.admin;
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Connect owner wallet" }));
  expect(ui.connect).toHaveBeenCalledOnce();
  expect(
    (screen.getByRole("button", { name: "Review timestamp" }) as HTMLButtonElement).disabled
  ).toBe(true);
});

it("blocks a malformed saved submission instead of treating it as a fresh send", async () => {
  localStorage.setItem("chain-upgrade:312:timestamp", JSON.stringify({ status: "pending" }));
  await load();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Review timestamp" }));
  await screen.findByRole("alert");
  expect(ui.wallet.sendTransaction).not.toHaveBeenCalled();
});
