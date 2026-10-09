import { ChainContext, StatusSourceContext } from "@/components/governance-context";
import { decodeCall } from "@/common/proposal";
import { act, render, screen, within } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// What a page shows first after a pause (.server/sync/last-shown.ts): what this app last showed,
// as of the block it was read at, under a notice that names that block, in no colour, with
// nothing to sign or send from it; the current data replaces it in the same response.

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useActionData: () => undefined,
  useNavigation: () => ({ state: "idle", location: undefined }),
  useNavigate: () => vi.fn(),
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
// The pages' server modules (their loaders are not run here).
vi.mock("@/.server/flows/common", () => ({ freshAfter: vi.fn() }));
vi.mock("@/.server/flows/standard", () => ({
  listStandardUpgrades: vi.fn(),
  loadStandardUpgrade: vi.fn(),
}));
vi.mock("@/.server/flows/emergency", () => ({
  loadEmergencyList: vi.fn(),
  loadEmergencyUpgrade: vi.fn(),
}));
vi.mock("@/.server/flows/freeze", () => ({ loadFreezeList: vi.fn() }));
vi.mock("@/.server/flows/l2-veto", () => ({ loadL2VetoList: vi.fn() }));
vi.mock("@/.server/governance", () => ({ governance: vi.fn() }));
vi.mock("@/.server/signatures", () => ({ simulate: vi.fn() }));
vi.mock("@/.server/rpc", () => ({ network: vi.fn(), l1: {} }));

const { default: Home } = await import("@/routes/_index/_route");
const { default: Upgrades } = await import("@/routes/app/proposals/_index/_route");
const { default: Upgrade } = await import("@/routes/app/proposals/$id/_route");
const { default: Emergency } = await import("@/routes/app/emergency/$id/_route");
const { default: Vetoes } = await import("@/routes/app/l2-cancellations/_index/_route");

const ADDRESS = "0x0000000000000000000000000000000000000001";
const ID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const AS_OF = { block: "21000000", timestamp: "1790000000" };
const HEADLINE = "As of block #21,000,000 · reading the newest block";

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
/** A deferred value already in (what the first flush renders at once). */
const settled = <T,>(value: T) =>
  Object.assign(Promise.resolve(value), { _tracked: true, _data: value }) as Promise<T>;

const CHAIN = {
  chainId: 1,
  label: "Ethereum Mainnet",
  isDevNode: false,
  explorerUrl: "https://etherscan.io",
  l2ExplorerUrl: null,
};

function wrap(children: ReactNode) {
  return (
    <ChainContext.Provider value={CHAIN}>
      <StatusSourceContext.Provider value={pending()}>{children}</StatusSourceContext.Provider>
    </ChainContext.Provider>
  );
}

/** What the page's first flush holds. */
function firstFlush(Page: () => ReactNode, data: Record<string, unknown>) {
  page.data = data;
  return renderToString(wrap(<Page />)).replaceAll("<!-- -->", "");
}

function show(Page: () => ReactNode, data: Record<string, unknown>) {
  page.data = data;
  return render(wrap(<Page />));
}

const governance = {
  network: { tallyUrl: null },
  latestBlock: { number: AS_OF.block, timestamp: AS_OF.timestamp },
  upgradeHandler: ADDRESS,
  securityCouncil: { address: ADDRESS },
  guardians: { address: ADDRESS },
  emergencyUpgradeBoard: { address: ADDRESS },
};

const proposal = {
  calls: [{ target: ADDRESS, value: "0", data: "0x" }],
  executor: ADDRESS,
  salt: `0x${"00".repeat(32)}`,
};

/** An upgrade ready to execute (state 4), as the page last showed it. */
const upgrade = (asOf?: typeof AS_OF) => ({
  id: ID,
  started: { id: ID, txHash: TX, blockNumber: "20000000", proposal, idMatches: true },
  calls: proposal.calls.map((c) => decodeCall(c as never)),
  state: 4,
  stateLabel: "Ready",
  status: {
    creationTimestamp: 1_780_000_000,
    securityCouncilApprovalTimestamp: 1_780_100_000,
    guardiansApproval: false,
    guardiansExtendedLegalVeto: false,
    executed: false,
  },
  timeline: {
    createdAt: 1_780_000_000,
    legalVetoEndsAt: 1_780_300_000,
    waitingEndsAt: 1_782_900_000,
    approvedAt: 1_780_100_000,
    readyAt: 1_780_186_400,
  },
  governance,
  ...(asOf ? { asOf } : {}),
});

const upgradeData = (detail: Promise<unknown>, freshDetail: Promise<unknown>) => ({
  id: ID,
  detail,
  freshDetail,
  sets: pending(),
  freshSets: pending(),
  evidence: pending(),
  setEvidence: pending(),
  execution: pending(),
  l2Proposal: pending(),
  startedCheck: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the upgrade page after a pause", () => {
  it("shows the upgrade as last shown in its first flush: its block first, in no colour, nothing to act on", () => {
    const out = firstFlush(Upgrade, upgradeData(settled(upgrade(AS_OF)), pending()));
    expect(out).toContain('data-testid="as-of"');
    expect(out).toContain(HEADLINE);
    expect(out).toContain("The state, timeline and calls below are as this app last showed them");
    // The proposal's content as last shown, in no colour.
    expect(out).toContain('data-testid="id-check"');
    expect(out).toMatch(/class="[^"]*grayscale[^"]*" data-stale="true"/);
    // Nothing that waits on the current reads, and nothing to execute or download from it.
    expect(out).not.toContain("Execute the upgrade");
    expect(out).not.toContain("Recorded approvals");
    expect(out).toContain("Checking the approvals and member signatures at the newest block");
    expect(out).not.toMatch(/upgrade-0xabababab/);
  });

  it("is replaced by the current upgrade, which shows what to act on", async () => {
    const fresh = deferred<unknown>();
    show(Upgrade, upgradeData(Promise.resolve(upgrade(AS_OF)), fresh.promise));
    expect(await screen.findByTestId("as-of")).toHaveTextContent(HEADLINE);
    expect(screen.queryByText("Execute the upgrade")).toBeNull();
    await act(async () => fresh.resolve(upgrade()));
    expect(screen.queryByTestId("as-of")).toBeNull();
    expect(screen.getByTestId("id-check")).toBeInTheDocument();
    expect(screen.getByText("Execute the upgrade")).toBeInTheDocument();
    expect(document.querySelector(".grayscale")).toBeNull();
  });

  it("gives way to the page's own error when the current read fails (as without it): never the upgrade as last shown with a generic note", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [error, said] of [
      [new Error("RPC down"), "RPC down"],
      [
        new Error("The handler has no standard upgrade with this id"),
        /The ProtocolUpgradeHandler has no standard upgrade with this id/,
      ],
    ] as const) {
      const fresh = deferred<unknown>();
      const view = show(Upgrade, upgradeData(Promise.resolve(upgrade(AS_OF)), fresh.promise));
      await screen.findByTestId("as-of");
      await act(async () => fresh.reject(error));
      expect(screen.queryByTestId("as-of")).toBeNull();
      expect(screen.getByText(said)).toBeInTheDocument();
      expect(screen.queryByTestId("id-check")).toBeNull();
      expect(screen.queryByText("Execute the upgrade")).toBeNull();
      view.unmount();
    }
  });

  it("without one kept, renders the current upgrade as before (no notice)", () => {
    const out = firstFlush(Upgrade, upgradeData(settled(upgrade()), settled(null)));
    expect(out).not.toContain('data-testid="as-of"');
    expect(out).not.toContain("grayscale");
    expect(out).toContain("Execute the upgrade");
  });
});

describe("the emergency upgrade page after a pause", () => {
  const held = {
    overview: { id: ID, state: 6, governance },
    execution: {
      txHash: TX,
      blockNumber: "20000000",
      proposal,
      calls: proposal.calls.map((c) => decodeCall(c as never)),
      idMatches: true,
    },
    asOf: AS_OF,
  };

  it("shows the upgrade and its execution as last shown, then the current ones", async () => {
    const data = {
      id: ID,
      lastShown: settled(held),
      detail: pending(),
      executed: pending(),
      executedCheck: null,
      executedHistorical: pending(),
      verified: pending(),
      verifiedFresh: pending(),
    };
    const out = firstFlush(Emergency, data);
    expect(out).toContain(HEADLINE);
    expect(out).toContain("The state and the execution below are as this app last showed them");
    expect(out).toContain('data-testid="id-check"');
    expect(out).toMatch(/class="[^"]*grayscale[^"]*" data-stale="true"/);
    expect(out).toContain("signatures at the newest block");
    // No payload to load, nothing to execute or download from it (as on the upgrade page).
    expect(out).not.toContain("What it will do");
    expect(out).not.toMatch(/>Execute<\/h2>/);
    expect(out).not.toMatch(/emergency-0xabababab/);
    expect(out).not.toContain("Copy upgrade file");

    const detail = deferred<unknown>();
    show(Emergency, { ...data, lastShown: Promise.resolve(held), detail: detail.promise });
    expect(await screen.findByTestId("as-of")).toHaveTextContent(HEADLINE);
    await act(async () => detail.resolve(held.overview));
    expect(screen.queryByTestId("as-of")).toBeNull();
  });
});

describe("the emergency upgrade page after a pause, its current read failing", () => {
  it("goes to the page's error (the route's error boundary), as without the upgrade as last shown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      override state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      override render() {
        return this.state.error ? (
          <p data-testid="route-error">{this.state.error.message}</p>
        ) : (
          this.props.children
        );
      }
    }
    const detail = deferred<unknown>();
    page.data = {
      id: ID,
      lastShown: Promise.resolve({
        overview: { id: ID, state: 6, governance },
        execution: null,
        asOf: AS_OF,
      }),
      detail: detail.promise,
      executed: pending(),
      executedCheck: null,
      executedHistorical: pending(),
      verified: pending(),
      verifiedFresh: pending(),
    };
    render(
      wrap(
        <Boundary>
          <Emergency />
        </Boundary>
      )
    );
    expect(await screen.findByTestId("as-of")).toHaveTextContent(HEADLINE);
    await act(async () => detail.reject(new Error("The upgrade's id does not match its calls")));
    expect(screen.getByTestId("route-error")).toHaveTextContent(
      "The upgrade's id does not match its calls"
    );
    expect(screen.queryByTestId("as-of")).toBeNull();
  });
});

describe("lists after a pause", () => {
  const list = {
    upgrades: [
      {
        id: ID,
        proposal,
        idMatches: true,
        blockNumber: "20000000",
        txHash: TX,
        state: 6,
        stateLabel: "Executed",
        createdAt: 1_780_000_000,
        approvedBySecurityCouncil: true,
        approvedByGuardians: false,
        legalVetoExtended: false,
      },
    ],
    fromBlock: "19000000",
    allHistory: false,
  };

  it("the upgrade list: as last shown, its rows in no colour, until the current list replaces it", async () => {
    const out = firstFlush(Upgrades, {
      list: settled({ ...list, asOf: AS_OF }),
      freshList: pending(),
      allHistory: false,
    });
    expect(out).toContain(HEADLINE);
    expect(out).toContain('data-testid="finished-upgrades"');

    const fresh = deferred<unknown>();
    show(Upgrades, {
      list: Promise.resolve({ ...list, asOf: AS_OF }),
      freshList: fresh.promise,
      allHistory: false,
    });
    const note = await screen.findByTestId("as-of");
    expect(note).toHaveTextContent("The upgrades and states listed below are as this app");
    expect(screen.getByTestId("finished-upgrades").closest("[data-stale]")).toHaveClass(
      "grayscale"
    );
    await act(async () => fresh.resolve(list));
    expect(screen.queryByTestId("as-of")).toBeNull();
    expect(screen.getByTestId("finished-upgrades").closest(".grayscale")).toBeNull();
  });

  it("the home page's counts: 'As of block #N' until the current count replaces them", async () => {
    const fresh = deferred<unknown>();
    show(Home, {
      upgrades: Promise.resolve({
        open: 0,
        total: 3,
        source: { lastRun: false, safeFetchedAt: null, asOfBlock: AS_OF.block },
        asOf: AS_OF,
      }),
      upgradesFresh: fresh.promise,
      emergency: pending(),
      emergencyFresh: pending(),
      freeze: pending(),
      freezeFresh: pending(),
      vetoes: pending(),
      vetoesFresh: pending(),
    });
    const row = screen.getByTestId("flow-upgrades");
    expect(await within(row).findByTestId("summary-note")).toHaveTextContent(
      "As of block #21,000,000 · re-verifying"
    );
    expect(row).toHaveTextContent("3 upgrades in the last 45 days");
    await act(async () => fresh.resolve({ open: 1, total: 4, source: null }));
    expect(within(row).queryByTestId("summary-note")).toBeNull();
    expect(row).toHaveTextContent("4 upgrades in the last 45 days");
  });

  it("a count fed by Safe: the one last shown gives way to the current count (from older Safe copies, labelled) as soon as it is in, then to the fresh one; or stays labelled when that fails", async () => {
    for (const outcome of ["fresh", "failed"] as const) {
      const current = deferred<unknown>();
      const after = deferred<unknown>();
      const view = show(Home, {
        upgrades: pending(),
        upgradesFresh: pending(),
        emergency: Promise.resolve({
          pending: 1,
          executed: 0,
          incomplete: false,
          source: { lastRun: false, safeFetchedAt: null, asOfBlock: AS_OF.block },
          asOf: AS_OF,
        }),
        emergencyFresh: current.promise,
        emergencyAfter: after.promise,
        freeze: pending(),
        freezeFresh: pending(),
        vetoes: pending(),
        vetoesFresh: pending(),
      });
      const row = screen.getByTestId("flow-emergency");
      expect(await within(row).findByTestId("summary-note")).toHaveTextContent(
        "As of block #21,000,000"
      );
      // The current count, from Safe copies 3 minutes old: in at once, labelled with their age.
      const copies = new Date(Date.now() - 180_000).toISOString();
      await act(async () =>
        current.resolve({
          pending: 2,
          executed: 0,
          incomplete: false,
          source: { lastRun: false, safeFetchedAt: copies, asOfBlock: null },
        })
      );
      expect(row).toHaveTextContent("2 pending");
      expect(within(row).getByTestId("summary-note")).not.toHaveTextContent("As of block");
      if (outcome === "fresh") {
        await act(async () =>
          after.resolve({ pending: 3, executed: 0, incomplete: false, source: null })
        );
        expect(row).toHaveTextContent("3 pending");
        expect(within(row).queryByTestId("summary-note")).toBeNull();
      } else {
        await act(async () => after.reject(new Error("Safe down")));
        expect(row).toHaveTextContent("2 pending");
        expect(within(row).getByTestId("summary-note")).toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("the signed vetoes: labelled with their block and Safe copies' age, no Check Safe now, in no colour", async () => {
    const signed = {
      vetoes: [
        {
          digest: `0x${"ee".repeat(32)}`,
          governor: ADDRESS,
          governorName: "Token governor",
          l2ProposalId: "123456789",
          l2GasLimit: "1",
          l2GasPerPubdataByteLimit: "1",
          refundRecipient: ADDRESS,
          txMintValue: "0",
          nonce: "3",
          reportedSigners: 2,
          state: { status: "done", detail: "Vetoed", txHash: null },
        },
      ],
      errors: [],
      anomalies: 0,
      safeFetchedAt: "2026-10-01T10:00:00.000Z",
      stale: true,
      asOf: AS_OF,
    };
    const fresh = deferred<unknown>();
    show(Vetoes, {
      signed: Promise.resolve(signed),
      freshSigned: fresh.promise,
      vetoable: pending(),
      freshVetoable: pending(),
    });
    const note = await screen.findByTestId("set-stale");
    expect(note).toHaveTextContent("Verified at block #21,000,000 · re-verifying");
    expect(note).toHaveTextContent(/Safe copies from .+ · refreshing/);
    expect(screen.queryByRole("button", { name: /Check Safe now/ })).toBeNull();
    expect(screen.getByTestId("vetoes").closest("[data-stale]")).toHaveClass("grayscale");
    await act(async () =>
      fresh.resolve({ ...signed, stale: false, asOf: undefined, safeFetchedAt: null })
    );
    expect(screen.queryByTestId("set-stale")).toBeNull();
    expect(screen.getByTestId("vetoes").closest(".grayscale")).toBeNull();
  });
});
