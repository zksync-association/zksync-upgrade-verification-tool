import { ChainContext, StatusSourceContext } from "@/components/governance-context";
import { decodeCall } from "@/common/proposal";
import { freshnessLabels } from "@/components/verification/freshness";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What a page shows first after a pause holds the signature sets it last showed with the upgrade
// (each as of the block it was verified at, in no colour, nothing to sign or send from it), and no
// set's Safe copies are said to be refreshing unless the current answer reads Safe again.

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
  useLoaderData: () => page.data,
  useActionData: () => undefined,
  useNavigation: () => ({ state: "idle", location: undefined }),
  useNavigate: () => vi.fn(),
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useSendTransaction: () => ({ sendTransaction: vi.fn(), isPending: false }),
  useSignTypedData: () => ({ signTypedData: vi.fn(), isPending: false }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
  ConnectButton: { Custom: () => null },
}));
// The pages' server modules (their loaders are not run here).
vi.mock("@/.server/flows/common", () => ({ freshAfter: vi.fn() }));
vi.mock("@/.server/flows/standard", () => ({ loadStandardUpgrade: vi.fn() }));
vi.mock("@/.server/flows/emergency", () => ({ loadEmergencyUpgrade: vi.fn() }));
vi.mock("@/.server/governance", () => ({ governance: vi.fn() }));
vi.mock("@/.server/signatures", () => ({ simulate: vi.fn() }));
vi.mock("@/.server/rpc", () => ({ network: vi.fn(), l1: {} }));

const { default: Upgrade } = await import("@/routes/app/proposals/$id/_route");
const { default: Emergency } = await import("@/routes/app/emergency/$id/_route");

const ADDRESS = "0x0000000000000000000000000000000000000001";
const MEMBER_A = "0x1000000000000000000000000000000000000001";
const MEMBER_B = "0x2000000000000000000000000000000000000002";
const ID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const AS_OF = { block: "21000000", timestamp: "1790000000" };
const NOW_S = Math.floor(Date.now() / 1000);

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

function firstFlush(Page: () => ReactNode, data: Record<string, unknown>) {
  page.data = data;
  return renderToString(
    <ChainContext.Provider value={CHAIN}>
      <StatusSourceContext.Provider value={pending()}>
        <Page />
      </StatusSourceContext.Provider>
    </ChainContext.Provider>
  ).replaceAll("<!-- -->", "");
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

/** An executed upgrade as the page last showed it. */
const upgrade = {
  id: ID,
  started: { id: ID, txHash: TX, blockNumber: "20000000", proposal, idMatches: true },
  calls: proposal.calls.map((c) => decodeCall(c as never)),
  state: 6,
  stateLabel: "Executed",
  status: {
    creationTimestamp: 1_780_000_000,
    securityCouncilApprovalTimestamp: 1_780_100_000,
    guardiansApproval: false,
    guardiansExtendedLegalVeto: false,
    executed: true,
  },
  timeline: {
    createdAt: 1_780_000_000,
    legalVetoEndsAt: 1_780_300_000,
    waitingEndsAt: 1_782_900_000,
    approvedAt: 1_780_100_000,
    readyAt: 1_780_186_400,
  },
  governance,
  asOf: AS_OF,
};

const member = (address: string, status: string) => ({
  member: address,
  label: null,
  safe: {
    address,
    isContract: true,
    version: "1.3.0",
    threshold: 2,
    owners: [],
    domainSeparatorMatches: true,
  },
  hashes: {
    domainHash: `0x${"d".repeat(64)}`,
    messageHash: `0x${"e".repeat(64)}`,
    safeMessageHash: `0x${"f".repeat(64)}`,
  },
  status,
  source: status === "missing" ? null : "safe",
  signature: status === "missing" ? null : "0xaa",
  owners: [],
  confirmations: 2,
  signedAt: null,
  error: null,
  safeWalletUrl: null,
});

/** A set as the loader sends it held (see .server/sync/last-shown.ts heldSet). */
const heldSet = (rereadsSafe: boolean) => ({
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup: "securityCouncil",
  typedData: {
    domain: { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: ADDRESS },
    types: { ApproveUpgradeSecurityCouncil: [{ name: "id", type: "bytes32" }] },
    primaryType: "ApproveUpgradeSecurityCouncil",
    message: { id: ID },
  },
  hashes: {
    domainSeparator: `0x${"a".repeat(64)}`,
    structHash: `0x${"b".repeat(64)}`,
    digest: `0x${"c".repeat(64)}`,
  },
  check: { kind: "multisig", contract: ADDRESS },
  threshold: 1,
  members: [member(MEMBER_A, "valid"), member(MEMBER_B, "missing")],
  valid: [{ signer: MEMBER_A, signature: "0xaa" }],
  thresholdCheck: { status: "met", checkedWith: "checkSignatures" },
  safeApiError: null,
  verifiedAtBlock: "20999990",
  safeFetchedAt: new Date((NOW_S - 600) * 1000).toISOString(),
  stale: true,
  reverifyingAt: null,
  safeCheck: null,
  rereadsSafe,
});

const heldApprovals = (asOf = AS_OF) => ({
  sets: [
    {
      key: "securityCouncil",
      title: "Security Council approval",
      set: heldSet(false),
      state: { status: "done", detail: "Approved by the Security Council", txHash: TX },
      execution: null,
      used: null,
      historical: null,
    },
  ],
  evidence: [
    {
      key: "securityCouncil",
      title: "Security Council approval",
      state: { status: "done", detail: "Approved by the Security Council", txHash: TX },
      used: null,
      historical: { block: "20000099", accepted: true, error: null },
    },
  ],
  asOf,
});

const upgradeData = (held: unknown) => ({
  id: ID,
  detail: settled(upgrade),
  freshDetail: pending(),
  heldApprovals: settled(held),
  sets: pending(),
  freshSets: pending(),
  evidence: pending(),
  setEvidence: pending(),
  execution: pending(),
  l2Proposal: pending(),
  startedCheck: null,
});

describe("Safe copies said to be refreshing", () => {
  const now = Date.parse("2026-10-06T08:00:00Z") / 1000;
  const stale = {
    verifiedAtBlock: "21000000",
    safeFetchedAt: new Date((now - 600) * 1000).toISOString(),
    stale: true,
    reverifyingAt: "21000005",
  };

  it("never for a set whose current answer keeps its copies", () => {
    expect(freshnessLabels({ ...stale, rereadsSafe: false }, "pending", now)).toEqual({
      verified: "Verified at block #21,000,000 · re-verifying at #21,000,005",
      copies: "Safe copies from 10m ago",
      failed: null,
    });
  });

  it("while the current answer reads Safe again (and where nothing says otherwise, as before)", () => {
    for (const set of [{ ...stale, rereadsSafe: true }, stale])
      expect(freshnessLabels(set, "pending", now).copies).toBe(
        "Safe copies from 10m ago · refreshing"
      );
  });
});

describe("the upgrade page's first flush after a pause", () => {
  it("holds its sets and recorded approvals as last shown, labelled, with nothing to act on", () => {
    const out = firstFlush(Upgrade, upgradeData(heldApprovals()));
    expect(out).toContain('data-testid="as-of"');
    // The set, under its own notice naming its block; its copies not said to be refreshing.
    expect(out).toContain('data-testid="set-securityCouncil"');
    expect(out).toContain('data-testid="set-stale"');
    expect(out).toContain("Verified at block #20,999,990 · re-verifying");
    expect(out).toMatch(/Safe copies from [^<·]+</);
    expect(out).not.toContain("refreshing");
    // The recorded approval as last shown, at the upgrade's block.
    expect(out).toContain('data-testid="recorded-approvals"');
    expect(out).toContain("As this app last showed them, read at block #21,000,000");
    expect(out).not.toContain("Checking the approvals and member signatures at the newest block");
    // In no colour, nothing to sign, fetch or send.
    expect(out).toMatch(
      /class="[^"]*grayscale[^"]*" data-stale="true"><section[^>]*>(?:(?!<\/section>).)*Recorded approvals/
    );
    expect(out).not.toContain('data-testid="sign-button"');
    expect(out).not.toContain('data-testid="fetch-signatures"');
    expect(out).not.toContain("Execute the upgrade");
    expect(out).not.toContain("Send transaction");
  });

  it("holds nothing kept with another block's upgrade, or nothing kept: their pending state", () => {
    for (const held of [heldApprovals({ block: "20999000", timestamp: "1" }), null]) {
      const out = firstFlush(Upgrade, upgradeData(held));
      expect(out).toContain("Checking the approvals and member signatures at the newest block");
      expect(out).not.toContain('data-testid="set-securityCouncil"');
      expect(out).not.toContain("Recorded approvals");
    }
  });
});

describe("the emergency upgrade page's first flush after a pause", () => {
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
  const data = (roles: unknown) => ({
    id: ID,
    lastShown: settled(held),
    lastShownRoles: settled(roles),
    detail: pending(),
    executed: pending(),
    executedCheck: null,
    executedHistorical: pending(),
    verified: pending(),
    verifiedFresh: pending(),
  });

  it("holds its signatures as last shown, labelled, with nothing to act on", () => {
    const roles = {
      roles: [
        { key: "securityCouncil", title: "Security Council", set: heldSet(false), used: null },
      ],
      executed: true,
      asOf: AS_OF,
    };
    const out = firstFlush(Emergency, data(roles));
    expect(out).toContain('data-testid="set-securityCouncil"');
    expect(out).toContain("Verified at block #20,999,990 · re-verifying");
    expect(out).not.toContain("refreshing");
    expect(out).not.toContain("signatures at the newest block");
    expect(out).not.toContain('data-testid="sign-button"');
    expect(out).not.toMatch(/>Execute<\/h2>/);
    expect(out).toMatch(/class="[^"]*grayscale[^"]*" data-stale="true"><section/);
  });

  it("holds nothing kept with another block's upgrade, or nothing kept: their pending state", () => {
    const other = { roles: [], executed: true, asOf: { block: "1", timestamp: "1" } };
    for (const roles of [other, null]) {
      const out = firstFlush(Emergency, data(roles));
      expect(out).toContain("signatures at the newest block");
      expect(out).not.toContain('data-testid="set-securityCouncil"');
    }
  });
});
