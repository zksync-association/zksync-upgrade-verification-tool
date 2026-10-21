import {
  ChainContext,
  type OkStatus,
  type RootStatus,
  type StatusSource,
  StatusSourceContext,
  useStatus,
} from "@/components/governance-context";
import { resetStatusRevalidation } from "@/utils/revalidation";
import { act, render, screen } from "@testing-library/react";
import { type ReactNode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The first bytes of every page: the app shell, the navigation and the page's own sections render
// before the root status (governance, trust anchors, log history) is read, and before any page
// data. Until the status is in, the header and banners say it is being checked, never that all is
// well; a page part that needs it waits for it on its own. renderToString renders what a first
// flush holds: every boundary still waiting shows its fallback.

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useActionData: () => undefined,
  useNavigation: () => ({ state: "idle", location: undefined }),
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "default" }),
  useNavigate: () => vi.fn(),
  Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  NavLink: ({
    to,
    children,
    className,
    end: _end,
    prefetch: _prefetch,
    ...props
  }: {
    to: string;
    children: ReactNode;
    className?: string | ((state: { isActive: boolean }) => string);
    end?: boolean;
    prefetch?: string;
  }) => (
    <a
      href={to}
      className={typeof className === "function" ? className({ isActive: false }) : className}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-hot-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/connect-button", async () => {
  const { createContext } = await import("react");
  return { default: () => null, WalletOfferContext: createContext(() => {}) };
});
// The pages' server modules (their loaders are not run here).
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
vi.mock("@/.server/flows/emergency-draft", () => ({ checkDraftCalls: vi.fn() }));
vi.mock("@/.server/flows/common", () => ({ freshAfter: vi.fn() }));
vi.mock("@/.server/governance", () => ({ governance: vi.fn() }));
vi.mock("@/.server/signatures", () => ({ simulate: vi.fn() }));
vi.mock("@/.server/rpc", () => ({ network: vi.fn(), l1: {} }));

const { default: AppShell } = await import("@/components/app-shell");

const ADDRESS = "0x0000000000000000000000000000000000000001";
const ID = `0x${"ab".repeat(32)}`;
const CHAIN = {
  chainId: 1,
  label: "Ethereum Mainnet",
  isDevNode: false,
  explorerUrl: "https://etherscan.io",
  l2ExplorerUrl: null,
};
const READY = {
  state: "ready",
  deployBlock: "20000000",
  coveredFrom: "20000000",
  finalizedTo: "21000000",
  headTo: "21000064",
  chunks: { done: 435, total: 435 },
  strategy: "chunked",
  span: "10000",
  logs: 98,
  error: null,
  provisional: null,
};

function okStatus(
  changes: { warnings?: string[]; overrides?: string[]; cache?: string } = {}
): OkStatus {
  return {
    ok: true,
    governance: {
      network: {
        label: "Ethereum Mainnet",
        chainId: 1,
        isDevNode: false,
        overrides: changes.overrides ?? [],
        explorerUrl: "https://etherscan.io",
      },
      latestBlock: { number: "21000064", timestamp: "1790000000" },
      warnings: changes.warnings ?? [],
      upgradeHandler: ADDRESS,
      securityCouncil: {
        address: ADDRESS,
        members: [ADDRESS, ADDRESS],
        eip1271Threshold: 9,
        thresholds: {},
      },
      guardians: {
        address: ADDRESS,
        members: [ADDRESS],
        eip1271Threshold: 5,
        thresholds: { cancelL2Proposal: 5 },
        nonce: "3",
      },
      emergencyUpgradeBoard: { address: ADDRESS, zkFoundation: ADDRESS },
    },
    logHistory: { status: "ok" },
    safeApi: { url: null, withKey: false, quota: { remaining: null, limit: null } },
    l2RpcConfigured: true,
    clientVersion: "test",
    sync: {
      index: READY,
      cache: {
        state: changes.cache ?? "verified",
        file: null,
        savedAt: null,
        sizeBytes: null,
        detail: null,
      },
    },
  } as unknown as OkStatus;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const pending = () => new Promise<never>(() => {});

/** Server HTML, without the comments React puts between adjacent text parts. */
const serverHtml = (element: ReactNode) => renderToString(element).replaceAll("<!-- -->", "");

function Shell({ status, children }: { status: StatusSource; children?: ReactNode }) {
  return (
    <ChainContext.Provider value={CHAIN}>
      <AppShell status={status}>{children ?? <p>page body</p>}</AppShell>
    </ChainContext.Provider>
  );
}

/** A page part that needs the status. */
function Thresholds() {
  const { governance } = useStatus();
  return <p>Council threshold {governance.securityCouncil.eip1271Threshold}</p>;
}

beforeEach(() => {
  resetStatusRevalidation();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the app shell before the status is read", () => {
  it("renders the header, the navigation and the page, and says the status is being checked", () => {
    const out = serverHtml(<Shell status={pending()} />);
    expect(out).toContain('aria-label="Governance navigation"');
    // Each destination is named for its page (the menu shows a word and an icon).
    for (const item of [
      "Overview",
      "Protocol upgrades",
      "Emergency upgrades",
      "Freeze requests",
      "Guardian veto",
      // Settings: the toggle floating at the bottom right.
      "Open settings",
    ])
      expect(out).toContain(`aria-label="${item}"`);
    expect(out).toContain("page body");
    expect(out).toContain("Ethereum Mainnet");
    expect(out).toContain("checking…");
    expect(out).toContain("Checking the governance contracts, trust anchors");
    expect(out).toContain("Reading the ProtocolUpgradeHandler and the roles it names");
  });

  it("never looks checked early: no block, no green dot, no trust anchor", () => {
    const out = serverHtml(<Shell status={pending()} />);
    expect(out).not.toContain("bg-green-500");
    expect(out).not.toContain('data-testid="block-age"');
    expect(out).not.toContain("ProtocolUpgradeHandler (pinned)");
    expect(out).not.toContain("Non-default trust anchor");
  });

  it("keeps a page part that needs the status waiting inside the shell", () => {
    const out = serverHtml(
      <Shell status={pending()}>
        <Thresholds />
      </Shell>
    );
    expect(out).toContain('aria-label="Governance navigation"');
    expect(out).toContain("Reading governance data");
    expect(out).not.toContain("Council threshold");
  });

  it("renders everything at once for a status already in hand", () => {
    const out = serverHtml(
      <Shell status={okStatus()}>
        <Thresholds />
      </Shell>
    );
    expect(out).toContain("Council threshold 9");
    expect(out).toContain('data-testid="block-age"');
    expect(out).toContain("ProtocolUpgradeHandler (pinned)");
    expect(out).not.toContain("checking…");
  });
});

describe("the checking banner", () => {
  it("floats over the page instead of taking a place in it, so nothing moves when it goes", async () => {
    const status = deferred<RootStatus>();
    render(<Shell status={status.promise} />);
    const banner = screen.getByTestId("status-checking-banner");
    // Out of the page's flow: in a fixed layer.
    expect(banner.closest(".fixed")).not.toBeNull();
    expect(screen.getByText("page body").closest(".fixed")).toBeNull();
    await act(async () => status.resolve(okStatus()));
    expect(screen.queryByTestId("status-checking-banner")).toBeNull();
    // No banner takes its place when all is well.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the footer's cache sentence", () => {
  it.each([
    ["verified", "keeps a local cache of public chain and Safe data between runs"],
    ["absent", "keeps a local cache of public chain and Safe data between runs"],
    ["disabled", "keeps nothing between runs"],
  ])("follows the chain cache's state (%s)", (state, text) => {
    const out = serverHtml(<Shell status={okStatus({ cache: state })} />);
    expect(out).toContain(text);
  });

  it("says nothing about the cache before the status is read", () => {
    const out = serverHtml(<Shell status={pending()} />);
    expect(out).not.toContain("between runs");
    expect(out).toContain("It never posts to Safe.");
  });
});

describe("the app shell once the status is read", () => {
  it("fills in the block, the banners and the trust anchors, and lets waiting parts render", async () => {
    const status = deferred<RootStatus>();
    render(
      <Shell status={status.promise}>
        <Thresholds />
      </Shell>
    );
    expect(screen.getByTestId("status-checking-banner")).toBeInTheDocument();
    expect(screen.getByTestId("status-checking")).toHaveTextContent("checking…");
    expect(screen.getByTestId("page-pending")).toBeInTheDocument();

    await act(async () => status.resolve(okStatus({ warnings: ["Guardians disagree"] })));
    expect(screen.queryByTestId("status-checking-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("status-checking")).not.toBeInTheDocument();
    expect(screen.getByTestId("block-age")).toHaveTextContent("block #21,000,064");
    expect(screen.getByText(/The governance contracts disagree/)).toBeInTheDocument();
    expect(screen.getByText("Council threshold 9")).toBeInTheDocument();
    expect(screen.getByText("ProtocolUpgradeHandler (pinned)")).toBeInTheDocument();
  });

  it("says why when it could not be read, in place of what needed it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = deferred<RootStatus>();
    render(
      <Shell status={status.promise}>
        <Thresholds />
      </Shell>
    );
    await act(async () =>
      status.resolve({ ok: false, error: "eth_call failed", hint: "Check L1_RPC_URL." })
    );
    expect(screen.getByTestId("status-problem")).toHaveTextContent(
      "Can't read the governance contracts."
    );
    expect(screen.getByTestId("status-problem")).toHaveTextContent("eth_call failed");
    expect(
      screen.getByRole("heading", { name: "Can't read the governance contracts" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Council threshold/)).not.toBeInTheDocument();
    expect(screen.getByTestId("status-checking")).toHaveTextContent("unavailable");
    error.mockRestore();
  });
});

describe("each page's first flush, before its data and the status are read", () => {
  /** The page as the shell renders it: a page that waited on the status would show PAGE WAITED. */
  function firstFlush(Page: () => ReactNode, data: Record<string, unknown>) {
    page.data = data;
    return serverHtml(
      <ChainContext.Provider value={CHAIN}>
        <StatusSourceContext.Provider value={pending()}>
          <Suspense fallback={<p>PAGE WAITED</p>}>
            <Page />
          </Suspense>
        </StatusSourceContext.Provider>
      </ChainContext.Provider>
    );
  }

  it("/: the lookup and every flow, each count still reading", async () => {
    const { default: Index } = await import("@/routes/_index/_route");
    const out = firstFlush(Index, {
      upgrades: pending(),
      emergency: pending(),
      freeze: pending(),
      vetoes: pending(),
    });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Governance review");
    expect(out).toContain("Open a proposal by ID");
    for (const flow of ["flow-upgrades", "flow-emergency", "flow-freeze", "flow-veto"])
      expect(out).toContain(`data-testid="${flow}"`);
    expect(out).toContain("Reading sources…");
  });

  it("/app/proposals: the header and the list's loading state", async () => {
    const { default: Proposals } = await import("@/routes/app/proposals/_index/_route");
    const out = firstFlush(Proposals, { list: pending(), freshList: pending(), allHistory: false });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Protocol upgrades");
    expect(out).toContain("Reading UpgradeStarted events from the ProtocolUpgradeHandler");
  });

  it("/app/proposals/<id>: the header with the id and the overview's loading state", async () => {
    const { default: Upgrade } = await import("@/routes/app/proposals/$id/_route");
    const out = firstFlush(Upgrade, { id: ID, detail: pending() });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain(ID);
    expect(out).toContain("Reading the proposal status and original calls from L1");
  });

  it("/app/emergency: both lists' sections, the thresholds sentence without numbers yet", async () => {
    const { default: Emergency } = await import("@/routes/app/emergency/_index/_route");
    const out = firstFlush(Emergency, {
      allHistory: false,
      pending: pending(),
      freshPending: pending(),
      executed: pending(),
      freshExecuted: pending(),
    });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Emergency upgrades");
    expect(out).toContain('id="pending-emergencies-heading"');
    expect(out).toContain('id="executed-emergencies-heading"');
    expect(out).toContain("once enough Security Council members");
    expect(out).toContain("Collecting emergency signatures");
  });

  it("/app/emergency/<id>: the header with the id and the status's loading state", async () => {
    const { default: Emergency } = await import("@/routes/app/emergency/$id/_route");
    const out = firstFlush(Emergency, { id: ID, detail: pending() });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain(ID);
    expect(out).toContain("Reading the emergency upgrade status from L1");
  });

  it("/app/l2-cancellations: the header without the threshold yet, and each list's loading state", async () => {
    const { default: Vetoes } = await import("@/routes/app/l2-cancellations/_index/_route");
    const out = firstFlush(Vetoes, {
      signed: pending(),
      freshSigned: pending(),
      vetoable: pending(),
      freshVetoable: pending(),
    });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Guardian veto");
    expect(out).toContain("Guardians can cancel a proposal");
    expect(out).toContain('id="signed-vetoes-heading"');
    expect(out).toContain('id="vetoable-heading"');
    expect(out).toContain("Collecting vetoes from Guardian Safes");
    expect(out).toContain("Reading active proposals from ZKsync Era governors");
    expect(out).not.toContain("Next nonce");
  });

  it("/app/freeze: the header, the facts and the list's loading state, without thresholds yet", async () => {
    const { default: Freeze } = await import("@/routes/app/freeze/_index/_route");
    const out = firstFlush(Freeze, { list: pending(), freshList: pending() });
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Freeze requests");
    expect(out).toContain("each need their own number of Security Council signatures");
    expect(out).toContain("Next nonces (soft · hard · unfreeze · threshold)");
    expect(out).toContain("Collecting freeze requests from Security Council Safes");
    // The new-request button waits for the nonces (disabled until then).
    expect(out).toMatch(/<button[^>]*disabled[^>]*data-testid="new-freeze"/);
  });

  it("/app/emergency/new: the header and the form; the id waits for the board's address", async () => {
    const { default: NewEmergency } = await import("@/routes/app/emergency/new/_route");
    const out = firstFlush(NewEmergency, {});
    expect(out).not.toContain("PAGE WAITED");
    expect(out).toContain("Prepare an emergency upgrade");
    expect(out).toContain("Call 1");
    expect(out).toContain("Add call");
    expect(out).toContain('data-testid="payload-pending"');
    expect(out).toContain("Reading the Emergency Upgrade Board");
  });
});
