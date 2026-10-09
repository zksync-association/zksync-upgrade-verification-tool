import { ChainContext } from "@/components/governance-context";
import { DIRECT_LABEL, LAST_RUN_LABEL } from "@/components/verification/last-run";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// An executed emergency upgrade's page while this run's log index has not confirmed the execution
// it shows (taken from the last run's history, or located directly): the calls appear at once,
// every part built from that transaction says where it came from until the index confirms it, and
// the board's re-checks (archive reads) stream in after the calls.

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
// The page's server modules (its loader is not run here).
vi.mock("@/.server/flows/emergency", () => ({ loadEmergencyUpgrade: vi.fn() }));
vi.mock("@/.server/flows/common", () => ({ freshAfter: vi.fn() }));
vi.mock("@/.server/governance", () => ({ governance: vi.fn() }));
vi.mock("@/.server/signatures", () => ({ simulate: vi.fn() }));

const { default: EmergencyPage } = await import("@/routes/app/emergency/$id/_route");

const ADDRESS = "0x0000000000000000000000000000000000000001";
const ID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pending = () => new Promise<never>(() => {});

const overview = {
  id: ID,
  state: 6, // Done
  governance: { emergencyUpgradeBoard: { address: ADDRESS } },
};

const execution = (label: Record<string, true>) => ({
  txHash: TX,
  blockNumber: "21000000",
  proposal: { calls: [], executor: ADDRESS, salt: `0x${"00".repeat(32)}` },
  calls: [],
  idMatches: true,
  ...label,
});

const accepted = {
  historical: {
    block: "20999999",
    checks: ["Security Council", "Guardians", "ZKsync Foundation"].map((role) => ({
      role,
      accepted: true,
      error: null,
    })),
  },
  historicalUnavailable: null,
};

function show(label: Record<string, true>) {
  const check = deferred<unknown>();
  const historical = deferred<unknown>();
  page.data = {
    id: ID,
    detail: Promise.resolve(overview),
    executed: Promise.resolve(execution(label)),
    executedCheck: check.promise,
    executedHistorical: historical.promise,
    verified: pending(),
    verifiedFresh: pending(),
  };
  render(
    <ChainContext.Provider
      value={{
        chainId: 1,
        label: "Ethereum Mainnet",
        isDevNode: false,
        explorerUrl: "https://etherscan.io",
        l2ExplorerUrl: null,
      }}
    >
      <EmergencyPage />
    </ChainContext.Provider>
  );
  return { check, historical };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an executed emergency upgrade's execution, before the index confirms it", () => {
  it("says it was located directly in the section built from it, then reads as any other", async () => {
    const { check, historical } = show({ locatedDirectly: true });
    expect(await screen.findByTestId("id-check")).toBeInTheDocument();
    expect(screen.getByTestId("last-run-check")).toHaveTextContent(DIRECT_LABEL);
    expect(
      screen.getByText(/located directly from archive state while the history index is verifying/)
    ).toBeInTheDocument();
    // The board's checks stream after the calls.
    expect(screen.getByTestId("board-checks")).toHaveTextContent(
      "Re-running the board's checks at block 20999999"
    );

    await act(async () => historical.resolve(accepted));
    expect(screen.getByTestId("board-checks")).toHaveTextContent("Security Council accepted");
    expect(screen.getByTestId("board-checks-unconfirmed")).toHaveTextContent(
      "which the history index has not confirmed yet"
    );

    await act(async () => check.resolve({ txHash: TX }));
    expect(screen.queryByTestId("last-run-check")).toBeNull();
    expect(screen.queryByText(/located directly/)).toBeNull();
    expect(screen.getByTestId("board-checks-unconfirmed")).toHaveTextContent(/^$/);
    expect(
      screen.getByText(
        "Rebuilt from the executeEmergencyUpgrade calldata of the execution transaction, and hashed again with the board as executor."
      )
    ).toBeInTheDocument();
  });

  it("says it came from the last run's history, and warns when the index does not confirm it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { check } = show({ fromLastRun: true });
    expect(await screen.findByTestId("last-run-check")).toHaveTextContent(LAST_RUN_LABEL);
    expect(
      screen.getByText(/in the history saved by the last run \(re-verifying\)/)
    ).toBeInTheDocument();

    await act(async () => check.reject(new Error("IndexIntegrityError")));
    expect(screen.getByTestId("last-run-mismatch")).toBeInTheDocument();
    expect(
      screen.getByText(
        /which the chain's current history did not confirm. Do not rely on these calls/
      )
    ).toBeInTheDocument();
  });

  it("shows the board's checks of an execution from this run's index without any provenance", async () => {
    const { historical } = show({});
    expect(await screen.findByTestId("id-check")).toBeInTheDocument();
    expect(screen.queryByTestId("last-run-check")).toBeNull();
    await act(async () => historical.resolve(accepted));
    expect(screen.getByTestId("board-checks")).toHaveTextContent("ZKsync Foundation accepted");
    expect(screen.queryByTestId("board-checks-unconfirmed")).toBeNull();
  });
});
