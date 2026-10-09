import type { SignatureSet } from "@/.server/signatures";
import { freshnessLabels } from "@/components/verification/freshness";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));

vi.mock("@/components/governance-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/governance-context")>()),
  useStatus: () => ({
    governance: {
      network: { explorerUrl: "https://etherscan.io", l2ExplorerUrl: null },
      securityCouncil: { members: [MEMBER_A, MEMBER_B, MEMBER_C] },
      guardians: { members: [] },
      emergencyUpgradeBoard: { zkFoundation: "0x0000000000000000000000000000000000000009" },
    },
  }),
}));

vi.mock("@remix-run/react", () => ({
  useRouteLoaderData: () => ({
    status: {
      ok: true,
      governance: {
        network: { explorerUrl: "https://etherscan.io", l2ExplorerUrl: null },
        securityCouncil: { members: [MEMBER_A, MEMBER_B, MEMBER_C] },
        guardians: { members: [] },
        emergencyUpgradeBoard: { zkFoundation: "0x0000000000000000000000000000000000000009" },
      },
    },
  }),
  useNavigate: () => vi.fn(),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("remix-routes", () => ({ $path: () => "/" }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wallet.address, isConnected: !!wallet.address }),
  useSendTransaction: () => ({ sendTransaction: vi.fn(), isPending: false }),
  useSignTypedData: () => ({ signTypedData: vi.fn(), isPending: false }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
  ConnectButton: { Custom: () => null },
}));

const MEMBER_A = "0x1000000000000000000000000000000000000001";
const MEMBER_B = "0x2000000000000000000000000000000000000002";
const MEMBER_C = "0x3000000000000000000000000000000000000003";
const hashes = {
  domainHash: `0x${"d".repeat(64)}`,
  messageHash: `0x${"e".repeat(64)}`,
  safeMessageHash: `0x${"f".repeat(64)}`,
};
const safe = (threshold: number) => ({
  address: "",
  isContract: true,
  version: "1.3.0",
  threshold,
  owners: [],
  domainSeparatorMatches: true,
});
const member = (address: string, status: string, extra: Record<string, unknown> = {}) => ({
  member: address,
  label: null,
  safe: safe(2),
  hashes,
  status,
  source: status === "missing" ? null : "safe",
  signature: status === "missing" ? null : "0xaa",
  owners: [],
  confirmations: status === "collecting" ? 1 : 2,
  signedAt: null,
  error: null,
  safeWalletUrl: null,
  ...extra,
});

const set = {
  action: "ApproveUpgradeSecurityCouncil",
  signerGroup: "securityCouncil",
  typedData: {
    domain: {
      name: "SecurityCouncil",
      version: "1",
      chainId: 1,
      verifyingContract: "0x59195219d1176E42f8e607e9AC114926D47f9035",
    },
    types: { ApproveUpgradeSecurityCouncil: [{ name: "id", type: "bytes32" }] },
    primaryType: "ApproveUpgradeSecurityCouncil",
    message: { id: `0x${"1".repeat(64)}` },
  },
  hashes: {
    domainSeparator: `0x${"a".repeat(64)}`,
    structHash: `0x${"b".repeat(64)}`,
    digest: `0x${"c".repeat(64)}`,
  },
  check: { kind: "multisig", contract: "0x59195219d1176E42f8e607e9AC114926D47f9035" },
  threshold: 2,
  members: [member(MEMBER_A, "valid"), member(MEMBER_B, "collecting"), member(MEMBER_C, "missing")],
  valid: [{ signer: MEMBER_A, signature: "0xaa" }],
  thresholdCheck: { status: "below", valid: 1, threshold: 2 },
  safeApiError: null,
} as never;

beforeEach(() => {
  wallet.address = undefined;
});

describe("SignatureSetCard", () => {
  it("shows each member's verdict and how many signatures are still needed", () => {
    render(
      <SignatureSetCard title="Security Council approval" set={set} state={{ status: "open" }} />
    );
    expect(screen.getByTestId("signature-count")).toHaveTextContent("1 / 2");
    expect(screen.getByTestId("threshold-below")).toHaveTextContent(
      "1 more valid signature needed."
    );
    const rows = screen.getAllByTestId("member-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
      "valid",
      "collecting",
      "missing",
    ]);
    expect(within(rows[0] as HTMLElement).getByText(/Verified/)).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(/Collecting · 1 of 2 owners/)
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Not signed")).toBeInTheDocument();
  });

  it("reveals the hashes a member's hardware wallet shows", () => {
    render(<SignatureSetCard title="t" set={set} state={{ status: "open" }} />);
    fireEvent.click(
      within(screen.getAllByTestId("member-row")[2] as HTMLElement).getByRole("button")
    );
    expect(screen.getByText(hashes.domainHash)).toBeInTheDocument();
    expect(screen.getByText(hashes.messageHash)).toBeInTheDocument();
    expect(screen.getByText(hashes.safeMessageHash)).toBeInTheDocument();
  });

  it("asks a visitor to connect, and only lets a member Safe sign", () => {
    const { rerender } = render(
      <SignatureSetCard title="t" set={set} state={{ status: "open" }} />
    );
    expect(screen.getByRole("button", { name: /Connect your Safe to sign/ })).toBeInTheDocument();

    wallet.address = "0x9999999999999999999999999999999999999999";
    rerender(<SignatureSetCard title="t" set={set} state={{ status: "open" }} />);
    expect(screen.getByTestId("sign-button")).toBeDisabled();
    expect(screen.getByText(/not a Security Council member Safe/)).toBeInTheDocument();

    wallet.address = MEMBER_C;
    rerender(<SignatureSetCard title="t" set={set} state={{ status: "open" }} />);
    expect(screen.getByTestId("sign-button")).toBeEnabled();

    wallet.address = MEMBER_A;
    rerender(<SignatureSetCard title="t" set={set} state={{ status: "open" }} />);
    expect(screen.getByTestId("sign-button")).toBeDisabled();
  });

  it("shows ready calldata with the simulation verdict, and no sign button once done", () => {
    render(
      <SignatureSetCard
        title="t"
        set={set}
        state={{ status: "done", detail: "Approved by the Security Council", txHash: null }}
        execution={
          {
            to: MEMBER_A,
            data: "0x1234",
            value: "0",
            functionName: "approve",
            simulation: { status: "ok" },
          } as never
        }
        used={[{ signer: MEMBER_A, signature: "0xaa", matchesSafe: true }]}
      />
    );
    expect(screen.getByTestId("calldata")).toHaveTextContent("0x1234");
    expect(screen.getByTestId("simulation-ok")).toBeInTheDocument();
    expect(screen.getByTestId("used-match")).toHaveTextContent("1 of 1");
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
    // Done: Safe's copies falling below the threshold today is not "signatures needed".
    expect(screen.getByTestId("threshold-below")).toHaveTextContent(
      "no longer reach the threshold"
    );
    expect(screen.queryByText(/more valid signature/)).not.toBeInTheDocument();
  });
  it("shows incomplete verification instead of a definitive shortfall when Safe data is unavailable", () => {
    const incompleteSet = {
      ...(set as SignatureSet),
      members: [member(MEMBER_A, "valid"), member(MEMBER_B, "unavailable")],
      safeApiError: "Rate limit reached",
    } as never;
    render(<SignatureSetCard title="Council" set={incompleteSet} state={{ status: "open" }} />);
    expect(screen.getByTestId("signature-count")).toHaveTextContent(
      "1 verified · check incomplete"
    );
    expect(screen.getByTestId("threshold-incomplete")).toHaveTextContent("lower bound");
    expect(screen.queryByTestId("threshold-below")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/more valid signature/)).not.toBeInTheDocument();
  });

  it("keeps the contract's accepted threshold authoritative during a partial API failure", () => {
    const metSet = {
      ...(set as SignatureSet),
      valid: [
        { signer: MEMBER_A, signature: "0xaa" },
        { signer: MEMBER_B, signature: "0xbb" },
      ],
      members: [
        member(MEMBER_A, "valid"),
        member(MEMBER_B, "valid"),
        member(MEMBER_C, "unavailable"),
      ],
      thresholdCheck: { status: "met", checkedWith: "checkSignatures" },
      safeApiError: "Some Safe data unavailable",
    } as never;
    render(<SignatureSetCard title="Council" set={metSet} state={{ status: "open" }} />);
    expect(screen.getByTestId("signature-count")).toHaveTextContent("2 / 2");
    expect(screen.getByTestId("threshold-met")).toHaveTextContent("Accepted by");
    expect(screen.queryByTestId("threshold-incomplete")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("does not hide a rejected contract check behind an API warning", () => {
    const rejectedSet = {
      ...(set as SignatureSet),
      thresholdCheck: {
        status: "rejected",
        checkedWith: "checkSignatures",
        error: "InvalidSignature",
      },
      safeApiError: "Some Safe data unavailable",
    } as never;
    render(<SignatureSetCard title="Council" set={rejectedSet} state={{ status: "open" }} />);
    expect(screen.getByText(/The contract rejected/)).toHaveTextContent("InvalidSignature");
    expect(screen.queryByTestId("threshold-incomplete")).not.toBeInTheDocument();
  });

  it("does not report unavailable historical Safe comparisons as mismatches", () => {
    render(
      <SignatureSetCard
        title="Council"
        set={set}
        state={{ status: "done", detail: "Approved by the Security Council", txHash: null }}
        used={[{ signer: MEMBER_A, signature: "0xaa", matchesSafe: null }]}
        historical={{ block: "100", accepted: true, error: null }}
      />
    );
    expect(screen.getByTestId("used-match")).toHaveTextContent("1 Safe copy could not be compared");
    expect(screen.getByTestId("done-summary")).toHaveTextContent("before execution): accepted");
    expect(screen.queryByText(/0 of 1/)).not.toBeInTheDocument();
  });

  it("does not request more signatures for a closed action", () => {
    render(
      <SignatureSetCard
        title="Council"
        set={set}
        state={{ status: "closed", detail: "The upgrade was executed" }}
      />
    );
    expect(screen.getByTestId("threshold-below")).toHaveTextContent("This action is closed");
    expect(screen.queryByText(/more valid signature/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
  });

  it("keeps a failed historical re-check visible on a completed action", () => {
    render(
      <SignatureSetCard
        title="Council"
        set={set}
        state={{ status: "done", detail: "Approved by the Security Council", txHash: null }}
        historical={{ block: "100", accepted: false, error: "InvalidSignature" }}
      />
    );
    expect(screen.getByTestId("done-summary")).toHaveTextContent("rejected (InvalidSignature)");
  });
});

describe("freshness labels", () => {
  const now = Date.parse("2026-10-06T08:00:00Z") / 1000;
  const ago = (seconds: number) => new Date((now - seconds) * 1000).toISOString();

  it("says the block a fresh set was verified at and how old its Safe copies are", () => {
    expect(
      freshnessLabels(
        { verifiedAtBlock: "21000000", safeFetchedAt: ago(12), stale: false },
        null,
        now
      )
    ).toEqual({
      verified: "Verified at block #21,000,000",
      copies: "Safe copies from 12s ago",
      failed: null,
    });
  });

  it("says a stale set is being verified again at the head, and its copies refreshed", () => {
    const stale = {
      verifiedAtBlock: "21000000",
      safeFetchedAt: ago(600),
      stale: true,
      reverifyingAt: "21000005",
    };
    expect(freshnessLabels(stale, "pending", now)).toEqual({
      verified: "Verified at block #21,000,000 · re-verifying at #21,000,005",
      copies: "Safe copies from 10m ago · refreshing",
      failed: null,
    });
    // Old copies at the current head: re-verified there, no other block to name.
    expect(freshnessLabels({ ...stale, reverifyingAt: "21000000" }, "pending", now).verified).toBe(
      "Verified at block #21,000,000 · re-verifying"
    );
    expect(freshnessLabels({ ...stale, reverifyingAt: null }, "pending", now).verified).toBe(
      "Verified at block #21,000,000 · re-verifying"
    );
    expect(freshnessLabels(stale, "failed", now)).toMatchObject({
      verified: "Verified at block #21,000,000",
      copies: "Safe copies from 10m ago",
      failed: expect.stringContaining("did not complete"),
    });
  });

  it("names the copies' time until this browser's clock is known (server render, hydration)", () => {
    expect(freshnessLabels({ safeFetchedAt: "2026-10-06T07:50:00.000Z" }, null, null).copies).toBe(
      "Safe copies from Oct 6, 2026, 07:50 UTC"
    );
  });

  it("has nothing to say for what a set does not carry (a dev node's 'latest', no Safe read)", () => {
    expect(freshnessLabels({ verifiedAtBlock: null, safeFetchedAt: null }, null, now)).toEqual({
      verified: null,
      copies: null,
      failed: null,
    });
  });
});

describe("SignatureSetCard with a stale first answer", () => {
  // Whole seconds ago by the browser clock the card reads (it counts whole seconds).
  const secondsAgo = (n: number) =>
    new Date((Math.floor(Date.now() / 1000) - n) * 1000).toISOString();
  const staleMet = {
    ...(set as SignatureSet),
    valid: [
      { signer: MEMBER_A, signature: "0xaa" },
      { signer: MEMBER_B, signature: "0xbb" },
    ],
    members: [member(MEMBER_A, "valid"), member(MEMBER_B, "valid"), member(MEMBER_C, "invalid")],
    thresholdCheck: { status: "met", checkedWith: "checkSignatures" },
    verifiedAtBlock: "1000",
    reverifyingAt: "1005",
    safeFetchedAt: secondsAgo(600),
    stale: true,
  } as never;

  it("names its block first and shows no verdict as a current pass, and nothing to sign", () => {
    render(
      <SignatureSetCard
        title="Council"
        set={staleMet}
        state={{ status: "open" }}
        refresh="pending"
      />
    );
    expect(screen.getByTestId("set-stale")).toHaveTextContent(
      "Verified at block #1,000 · re-verifying at #1,005"
    );
    expect(screen.getByTestId("set-stale")).toHaveTextContent(
      "Safe copies from 10m ago · refreshing"
    );
    // Met at that block, not "Threshold met" now.
    expect(screen.queryByTestId("threshold-met")).not.toBeInTheDocument();
    expect(screen.getByTestId("threshold-stale")).toHaveTextContent(
      "At block #1,000 the threshold was met"
    );
    expect(screen.getByText("verified at block #1,000 / required")).toBeInTheDocument();
    const rows = screen.getAllByTestId("member-row");
    expect(within(rows[0] as HTMLElement).getByText(/Valid at #1,000/)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText(/Verified/)).not.toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText(/Rejected at #1,000/)).toBeInTheDocument();
    for (const row of rows) expect(row.className).not.toMatch(/bg-(green|red)-50/);
    expect(screen.getByTestId("set-stale").closest("[data-stale]")).toHaveAttribute(
      "data-stale",
      "true"
    );
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Connect your Safe to sign/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar").innerHTML).not.toContain("bg-green-700");
  });

  it("says when checking again did not complete, and keeps the old block named", () => {
    render(
      <SignatureSetCard
        title="Council"
        set={staleMet}
        state={{ status: "open" }}
        refresh="failed"
      />
    );
    expect(screen.getByTestId("set-stale")).toHaveTextContent("Verified at block #1,000");
    expect(screen.getByTestId("set-stale")).not.toHaveTextContent("re-verifying");
    expect(screen.getByTestId("set-stale")).toHaveTextContent("did not complete");
  });

  it("never says a fresh set beside a stale one is being checked again", () => {
    const fresh = {
      ...(staleMet as unknown as Record<string, unknown>),
      stale: false,
      reverifyingAt: undefined,
      verifiedAtBlock: "1005",
    } as never;
    render(
      <SignatureSetCard title="Council" set={fresh} state={{ status: "open" }} refresh="pending" />
    );
    expect(screen.getByTestId("set-freshness")).toHaveTextContent("Verified at block #1,005");
    expect(screen.getByTestId("set-freshness")).not.toHaveTextContent(/re-verifying|refreshing/);
  });

  it("labels a fresh set quietly and shows its verdicts as current", () => {
    const fresh = {
      ...(staleMet as unknown as Record<string, unknown>),
      stale: false,
      reverifyingAt: undefined,
      verifiedAtBlock: "1005",
      safeFetchedAt: secondsAgo(5),
    } as never;
    render(<SignatureSetCard title="Council" set={fresh} state={{ status: "open" }} />);
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(
      /^Verified at block #1,005 · Safe copies from [56]s ago$/
    );
    expect(screen.queryByTestId("set-stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("threshold-met")).toBeInTheDocument();
    const rows = screen.getAllByTestId("member-row");
    expect(within(rows[0] as HTMLElement).getByText(/Verified/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect your Safe to sign/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar").innerHTML).toContain("bg-green-700");
  });
});
