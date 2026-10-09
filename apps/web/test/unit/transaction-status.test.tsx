import { GovernanceContext, type OkStatus } from "@/components/governance-context";
import {
  noteStatusLanded,
  resetStatusRevalidation,
  shouldRevalidateRoot,
} from "@/utils/revalidation";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The receipt is never polled: the sync engine reads it each block, the beat triggers a reload.
// Once it is in, the status (freeze state and nonces, members, thresholds) predates the
// transaction, so the page reads it again until it covers the transaction's block, a few times.

type Receipt = { status: string; blockNumber: string; from: string; to: string; fee: string };
type Answer = { receipt: Receipt | null; unread: boolean };
const page = vi.hoisted(() => ({
  data: {
    hash: `0x${"ab".repeat(32)}`,
    receipt: { receipt: null, unread: false } as Answer,
    followed: true as boolean,
  },
  revalidator: { state: "idle", revalidate: vi.fn() },
}));
vi.mock("@/.server/rpc", () => ({ l1: {} }));
vi.mock("@/.server/sync/receipt", () => ({
  pageReceipt: vi.fn(),
  receiptContent: vi.fn(),
  receiptFollowed: vi.fn(),
}));
vi.mock("@remix-run/react", async (importOriginal) => ({
  // Await: the receipt is deferred (here already in hand, so it renders at once).
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useRevalidator: () => page.revalidator,
}));

const { default: Transaction } = await import("@/routes/app/transactions.$hash/_route");

const mined = (blockNumber: string): Receipt => ({
  status: "success",
  blockNumber,
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  fee: "1000",
});

function status(block: string): OkStatus {
  return {
    ok: true,
    governance: {
      network: { label: "Ethereum", chainId: 1, explorerUrl: null },
      latestBlock: { number: block, timestamp: "1790000000" },
    },
  } as unknown as OkStatus;
}

function view(block: string) {
  const ui = (s: OkStatus) => (
    <GovernanceContext.Provider value={s}>
      <Transaction />
    </GovernanceContext.Provider>
  );
  const first = status(block);
  noteStatusLanded(first);
  const rendered = render(ui(first));
  return {
    /**
     * The router's revalidation pass: it asks the root whether to read the status (a new one,
     * at `newStatusBlock`, lands only if so), then loading, then idle with the loaders' data.
     */
    async revalidated(receipt: Receipt | null, newStatusBlock?: string) {
      const rootRead = shouldRevalidateRoot({ defaultShouldRevalidate: true });
      expect(rootRead).toBe(newStatusBlock !== undefined);
      page.revalidator = { ...page.revalidator, state: "loading" };
      rendered.rerender(ui(first));
      page.data = { ...page.data, receipt: { receipt, unread: false } };
      page.revalidator = { ...page.revalidator, state: "idle" };
      const next = newStatusBlock ? status(newStatusBlock) : first;
      if (newStatusBlock) noteStatusLanded(next);
      rendered.rerender(ui(next));
      await act(() => vi.advanceTimersByTimeAsync(0));
    },
  };
}

const toggle = { defaultShouldRevalidate: true };
const revalidate = () => page.revalidator.revalidate;

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusRevalidation();
  page.data = { ...page.data, receipt: { receipt: null, unread: false }, followed: true };
  page.revalidator = { state: "idle", revalidate: vi.fn() };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the transaction page and the root status", () => {
  it("polls nothing while waiting for the receipt, visible or not", async () => {
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(shouldRevalidateRoot(toggle)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(revalidate()).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("checked at each new block");
  });

  it("reads the status once when the receipt arrives (the beat's reload), and stops once it covers the block", async () => {
    const v = view("100");
    // The reload the beat asked for (it changed), with the receipt.
    await v.revalidated(mined("101"));
    expect(revalidate()).toHaveBeenCalledTimes(1);
    // That revalidation reads the root (see revalidated()).
    await v.revalidated(mined("101"), "101");
    expect(shouldRevalidateRoot(toggle)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(revalidate()).toHaveBeenCalledTimes(1);
  });

  it("tries again while the server's status still trails the receipt, three reads at most", async () => {
    const v = view("100");
    await v.revalidated(mined("105"));
    expect(revalidate()).toHaveBeenCalledTimes(1);
    for (const at of ["103", "104"]) {
      await v.revalidated(mined("105"), at);
      expect(shouldRevalidateRoot(toggle)).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(3_999));
      const before = revalidate().mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(revalidate()).toHaveBeenCalledTimes(before + 1);
    }
    expect(revalidate()).toHaveBeenCalledTimes(3);
    await v.revalidated(mined("105"), "104");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(revalidate()).toHaveBeenCalledTimes(3);
  });

  it("leaves the status alone for a transaction mined before it was read", async () => {
    page.data = { ...page.data, receipt: { receipt: mined("99"), unread: false } };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(revalidate()).not.toHaveBeenCalled();
    expect(shouldRevalidateRoot(toggle)).toBe(false);
  });

  it("says when the receipt could not be read, never that the transaction is not mined", async () => {
    page.data = { ...page.data, receipt: { receipt: null, unread: true } };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(document.body.textContent).toContain("Could not read the transaction receipt");
    expect(document.body.textContent).not.toContain("Waiting for the transaction to be mined");
  });

  it("asks for a reload where nothing reads the receipt again (a dev node, SYNC_MODE=off)", async () => {
    page.data = { ...page.data, followed: false };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(document.body.textContent).toContain("Waiting for the transaction to be mined");
    expect(document.body.textContent).toContain("reload the page to check again");
    expect(document.body.textContent).not.toContain("checked at each new block");
  });

  it("reads it right away when the transaction was already mined on arrival (a fast chain)", async () => {
    page.data = { ...page.data, receipt: { receipt: mined("101"), unread: false } };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(revalidate()).toHaveBeenCalledTimes(1);
    expect(shouldRevalidateRoot(toggle)).toBe(true);
  });
});
