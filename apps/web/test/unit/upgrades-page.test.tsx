import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The upgrades page: a short header, nothing in progress said in one line, and the completed
// upgrades' time range in a dropdown.

const page = vi.hoisted(() => ({ range: "45", navigate: vi.fn() }));
vi.mock("@/.server/flows/standard", () => ({ listStandardUpgrades: vi.fn() }));
vi.mock("@remix-run/react", async (original) => ({
  ...(await original<typeof import("@remix-run/react")>()),
  useLoaderData: () => ({
    list: Promise.resolve({
      upgrades: [
        {
          id: `0x${"1".padStart(64, "0")}`,
          proposal: { calls: [], executor: `0x${"00".repeat(20)}`, salt: `0x${"00".repeat(32)}` },
          idMatches: true,
          blockNumber: "21800000",
          txHash: `0x${"ab".repeat(32)}`,
          state: 6,
          stateLabel: "Done",
          createdAt: 1_700_000_000,
          approvedBySecurityCouncil: true,
          approvedByGuardians: false,
          legalVetoExtended: false,
        },
      ],
      fromBlock: "21788382",
      allHistory: false,
    }),
    freshList: Promise.resolve(null),
    range: page.range,
  }),
  useNavigation: () => ({ state: "idle" }),
  useNavigate: () => page.navigate,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const { default: Proposals } = await import("@/routes/app/proposals/_index/_route");

beforeEach(() => {
  page.range = "45";
  page.navigate.mockReset();
});

describe("the upgrades page", () => {
  it("keeps the header to a title, one line and Start upgrade", async () => {
    render(<Proposals />);
    expect(screen.getByRole("link", { name: "Start upgrade" })).toBeInTheDocument();
    expect(
      screen.getByText("Upgrades voted on ZKsync Era and started on L1, and where each stands.")
    ).toBeInTheDocument();
    expect(screen.queryByText("How upgrades work")).toBeNull();
  });

  it("says nothing is in progress in one line, and lists completed upgrades under their range", async () => {
    render(<Proposals />);
    expect(await screen.findByTestId("no-active")).toHaveTextContent("No active upgrades");
    expect(screen.queryByTestId("active-upgrades")).toBeNull();
    expect(screen.getByRole("heading", { name: "Completed upgrades" })).toBeInTheDocument();
    expect(screen.getAllByTestId("upgrade-row")).toHaveLength(1);
  });

  it("switches the range from its dropdown: last 45 days, last 90 days, all time", async () => {
    page.range = "90";
    render(<Proposals />);
    const select = (await screen.findByTestId("upgrade-window")) as HTMLSelectElement;
    expect(select.value).toBe("90");
    expect([...select.options].map((o) => o.text)).toEqual([
      "Last 45 days",
      "Last 90 days",
      "All time",
    ]);
    fireEvent.change(select, { target: { value: "all" } });
    expect(page.navigate).toHaveBeenLastCalledWith("/app/proposals?history=all");
    fireEvent.change(select, { target: { value: "45" } });
    expect(page.navigate).toHaveBeenLastCalledWith("/app/proposals");
  });
});
