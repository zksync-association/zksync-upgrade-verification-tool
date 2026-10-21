import { ChainContext, GovernanceContext, type OkStatus } from "@/components/governance-context";
import type { LiveState } from "@/components/presence";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// A page's own item that the beats name at an older block than the served head (notedAt) is
// labelled as of that block, in no passing colour, with nothing to download, until read again.

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
// The pages' server modules (their loaders are not run here).
vi.mock("@/.server/rpc", () => ({ l1: {} }));
vi.mock("@/.server/sync/receipt", () => ({
  pageReceipt: vi.fn(),
  receiptContent: vi.fn(),
  receiptFollowed: vi.fn(),
}));
vi.mock("@/.server/flows/emergency", () => ({ loadEmergencyUpgrade: vi.fn() }));
vi.mock("@/.server/flows/common", () => ({ freshAfter: vi.fn() }));
vi.mock("@/.server/governance", () => ({ governance: vi.fn() }));
vi.mock("@/.server/signatures", () => ({ simulate: vi.fn() }));

const { default: Transaction } = await import("@/routes/app/transactions.$hash/_route");
const { default: EmergencyPage } = await import("@/routes/app/emergency/$id/_route");
const { INITIAL_LIVE, LiveStateProvider } = await import("@/components/presence");

const ADDRESS = "0x0000000000000000000000000000000000000001";
const HASH = `0x${"ab".repeat(32)}`;
const ID = `0x${"cd".repeat(32)}`;
const SERVED = { number: "21000070", hash: "0x01", timestamp: "1790000072" };

const live = (notedAt: LiveState["notedAt"]): LiveState => ({
  ...INITIAL_LIVE,
  head: SERVED,
  notedAt,
});

const status = {
  ok: true,
  governance: {
    network: { label: "Ethereum", chainId: 1, explorerUrl: null },
    latestBlock: { number: "21000080", timestamp: "1790000100" },
  },
} as unknown as OkStatus;

const chain = {
  chainId: 1,
  label: "Ethereum Mainnet",
  isDevNode: false,
  explorerUrl: "https://etherscan.io",
  l2ExplorerUrl: null,
};

function wrap(state: LiveState, children: ReactNode) {
  return (
    <ChainContext.Provider value={chain}>
      <GovernanceContext.Provider value={status}>
        <LiveStateProvider value={state}>{children}</LiveStateProvider>
      </GovernanceContext.Provider>
    </ChainContext.Provider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a transaction's receipt not read again at the served head", () => {
  const key = `tx:${HASH}`;
  const show = (notedAt: LiveState["notedAt"]) => {
    page.data = {
      hash: HASH,
      receipt: {
        receipt: {
          status: "success",
          blockNumber: "21000060",
          from: ADDRESS,
          to: ADDRESS,
          fee: "1000",
        },
        unread: false,
      },
      followed: true,
    };
    return render(wrap(live(notedAt), <Transaction />));
  };

  it("is labelled as of its block, its status in no passing colour", async () => {
    const view = show({ [key]: { rev: "4", block: "21000066" } });
    const succeeded = await screen.findByText(/Succeeded in block 21000060/);
    expect(screen.getByTestId("not-reread")).toHaveTextContent(
      "As of block #21,000,066 · not re-read at #21,000,070"
    );
    expect(succeeded.closest("[data-stale='true']")).toHaveClass("grayscale");
    view.unmount();
  });

  it("read again at the served head: no label, its colour kept", async () => {
    show({ [key]: { rev: "4", block: SERVED.number } });
    const succeeded = await screen.findByText(/Succeeded in block 21000060/);
    expect(screen.queryByTestId("not-reread")).not.toBeInTheDocument();
    expect(succeeded.closest("[data-stale='true']")).toBeNull();
  });
});

describe("an executed emergency upgrade's state not read again at the served head", () => {
  const key = `emergency:${ID}`;
  const show = (notedAt: LiveState["notedAt"]) => {
    const pending = new Promise<never>(() => {});
    page.data = {
      id: ID,
      detail: Promise.resolve({
        id: ID,
        state: 6, // Done
        governance: { emergencyUpgradeBoard: { address: ADDRESS } },
      }),
      lastShown: null,
      executed: Promise.resolve({
        txHash: `0x${"ef".repeat(32)}`,
        blockNumber: "21000000",
        proposal: { calls: [], executor: ADDRESS, salt: `0x${"00".repeat(32)}` },
        calls: [],
        idMatches: true,
      }),
      executedCheck: pending,
      executedHistorical: pending,
      verified: pending,
      verifiedFresh: pending,
    };
    return render(wrap(live(notedAt), <EmergencyPage />));
  };

  it("is labelled as of its block, in no colour", async () => {
    const view = show({ [key]: { rev: "9", block: "21000066" } });
    const idCheck = await screen.findByTestId("id-check");
    expect(screen.getByTestId("not-reread")).toHaveTextContent(
      "As of block #21,000,066 · not re-read at #21,000,070"
    );
    expect(idCheck.closest("[data-stale='true']")).toHaveClass("grayscale");
    expect(screen.getByText("Executed").closest("[data-stale='true']")).not.toBeNull();
    view.unmount();
  });

  it("read again at the served head: no label", async () => {
    show({ [key]: { rev: "9", block: SERVED.number } });
    const idCheck = await screen.findByTestId("id-check");
    expect(screen.queryByTestId("not-reread")).not.toBeInTheDocument();
    expect(idCheck.closest("[data-stale='true']")).toBeNull();
  });
});
