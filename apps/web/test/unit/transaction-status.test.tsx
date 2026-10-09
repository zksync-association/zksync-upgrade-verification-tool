import { GovernanceContext, type OkStatus } from "@/components/governance-context";
import {
  noteStatusLanded,
  resetStatusRevalidation,
  shouldRevalidateRoot,
} from "@/utils/revalidation";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The transaction page after Send. Its 4 s polls for the receipt leave the root status alone;
// once the receipt is in, the status other pages read (freeze state and nonces, members,
// thresholds) predates the transaction, so the page reads it again until it is at least as new
// as the transaction's block, a few times at most.

type Receipt = { status: string; blockNumber: string; from: string; to: string; fee: string };
const page = vi.hoisted(() => ({
  data: { hash: `0x${"ab".repeat(32)}`, receipt: null as Receipt | null },
  revalidator: { state: "idle", revalidate: vi.fn() },
}));
vi.mock("@/.server/rpc", () => ({ l1: {} }));
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
      page.data = { ...page.data, receipt };
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
  page.data = { ...page.data, receipt: null };
  page.revalidator = { state: "idle", revalidate: vi.fn() };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the transaction page and the root status", () => {
  it("polls for the receipt without reading the status", async () => {
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(revalidate()).toHaveBeenCalledTimes(2);
    expect(shouldRevalidateRoot(toggle)).toBe(false);
  });

  it("reads the status once when the receipt arrives, and stops once it covers the block", async () => {
    const v = view("100");
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(revalidate()).toHaveBeenCalledTimes(1); // the poll that finds the receipt
    await v.revalidated(mined("101"));
    expect(revalidate()).toHaveBeenCalledTimes(2);
    // That revalidation reads the root (see revalidated()).
    await v.revalidated(mined("101"), "101");
    expect(shouldRevalidateRoot(toggle)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(revalidate()).toHaveBeenCalledTimes(2);
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
    page.data = { ...page.data, receipt: mined("99") };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(revalidate()).not.toHaveBeenCalled();
    expect(shouldRevalidateRoot(toggle)).toBe(false);
  });

  it("polls only while the tab is visible", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    try {
      view("100");
      await act(() => vi.advanceTimersByTimeAsync(8_000));
      expect(revalidate()).toHaveBeenCalledTimes(2);
      await act(async () => {
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
      expect(revalidate()).toHaveBeenCalledTimes(2);
      await act(async () => {
        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(() => vi.advanceTimersByTimeAsync(4_000));
      expect(revalidate()).toHaveBeenCalledTimes(3);
    } finally {
      visibility = "visible";
    }
  });

  it("stops after 30 minutes without a receipt, and says so", async () => {
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
    const polls = revalidate().mock.calls.length;
    expect(polls).toBeGreaterThanOrEqual(449);
    expect(polls).toBeLessThanOrEqual(450);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(revalidate()).toHaveBeenCalledTimes(polls);
    expect(document.body.textContent).toContain("Stopped checking after 30 minutes");
  });

  it("reads it right away when the transaction was already mined on arrival (a fast chain)", async () => {
    page.data = { ...page.data, receipt: mined("101") };
    view("100");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(revalidate()).toHaveBeenCalledTimes(1);
    expect(shouldRevalidateRoot(toggle)).toBe(true);
  });
});
