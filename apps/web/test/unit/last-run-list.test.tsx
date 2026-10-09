import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  list: Promise.resolve() as Promise<unknown>,
  freshList: Promise.resolve(null) as Promise<unknown>,
}));
vi.mock("@/.server/flows/standard", () => ({ listStandardUpgrades: vi.fn() }));
vi.mock("@remix-run/react", async (original) => ({
  ...(await original<typeof import("@remix-run/react")>()),
  useLoaderData: () => ({ list: data.list, freshList: data.freshList, allHistory: true }),
  useNavigation: () => ({ state: "idle" }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const { default: Proposals } = await import("@/routes/app/proposals/_index/_route");

const upgrade = (n: number) => ({
  id: `0x${n.toString(16).padStart(64, "0")}`,
  proposal: { calls: [], executor: `0x${"00".repeat(20)}`, salt: `0x${"00".repeat(32)}` },
  idMatches: true,
  blockNumber: "21800000",
  txHash: `0x${"ab".repeat(32)}`,
  state: 5,
  stateLabel: "Done",
  createdAt: 1_700_000_000,
  approvedBySecurityCouncil: true,
  approvedByGuardians: false,
  legalVetoExtended: false,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const list = (ids: number[], fromLastRun?: true) => ({
  upgrades: ids.map(upgrade),
  fromBlock: "21788382",
  allHistory: true,
  ...(fromLastRun ? { fromLastRun } : {}),
});

beforeEach(() => {
  data.list = Promise.resolve(list([1]));
  data.freshList = Promise.resolve(null);
});

describe("the upgrade list from the last run's history", () => {
  it("is labelled until this run's list replaces it", async () => {
    const fresh = deferred<unknown>();
    data.list = Promise.resolve(list([1, 2], true));
    data.freshList = fresh.promise;
    render(<Proposals />);
    expect(await screen.findByTestId("last-run")).toHaveTextContent(
      "History from last run · re-verifying"
    );
    expect(screen.getAllByTestId("upgrade-row")).toHaveLength(2);

    await act(async () => fresh.resolve(list([1])));
    expect(screen.queryByTestId("last-run")).toBeNull();
    expect(screen.getAllByTestId("upgrade-row")).toHaveLength(1);
  });

  it("stays labelled, saying so, when this run's list fails", async () => {
    const fresh = deferred<unknown>();
    data.list = Promise.resolve(list([1], true));
    data.freshList = fresh.promise;
    render(<Proposals />);
    await screen.findByTestId("last-run");
    await act(async () => fresh.reject(new Error("RPC down")));
    expect(await screen.findByText(/did not complete/)).toBeInTheDocument();
    expect(screen.getByTestId("last-run")).toHaveTextContent("History from last run");
  });

  it("has no notice for a list this run read", async () => {
    render(<Proposals />);
    expect(await screen.findAllByTestId("upgrade-row")).toHaveLength(1);
    expect(screen.queryByTestId("last-run")).toBeNull();
  });
});
