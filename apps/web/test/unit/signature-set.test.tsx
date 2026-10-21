import type { SignatureSet } from "@/.server/signatures";
import { INITIAL_LIVE, type LiveState, LiveStateProvider } from "@/components/presence";
import {
  NotReReadNote,
  PageCurrency,
  contentCurrency,
} from "@/components/verification/content-currency";
import { SimulationResult } from "@/components/verification/execution-panel";
import {
  EraBlockNote,
  freshnessLabels,
  newerCheck,
  setCurrency,
} from "@/components/verification/freshness";
import { ApprovalGroups, SignatureSetCard } from "@/components/verification/signature-set";
import { YourSignature } from "@/components/verification/your-signature";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));
const walletSign = vi.hoisted(() => ({ signTypedData: vi.fn() }));
const walletSend = vi.hoisted(() => ({ sendTransaction: vi.fn() }));
// Whether the root status has been read (the card never waits for it).
const root = vi.hoisted(() => ({ read: true }));

vi.mock("@/components/governance-context", async (importOriginal) => {
  const status = () => ({
    ok: true,
    governance: {
      network: { explorerUrl: "https://etherscan.io", l2ExplorerUrl: null },
      securityCouncil: { members: [MEMBER_A, MEMBER_B, MEMBER_C] },
      guardians: { members: [] },
      emergencyUpgradeBoard: { zkFoundation: "0x0000000000000000000000000000000000000009" },
    },
  });
  return {
    ...(await importOriginal<typeof import("@/components/governance-context")>()),
    useStatus: () => {
      if (!root.read) throw new Error("the card waited for the root status");
      return status();
    },
    useStatusIfRead: () => (root.read ? status() : null),
  };
});

vi.mock("@remix-run/react", () => ({
  useNavigate: () => vi.fn(),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("remix-routes", () => ({ $path: () => "/" }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: wallet.address, isConnected: !!wallet.address }),
  useSendTransaction: () => ({ sendTransaction: walletSend.sendTransaction, isPending: false }),
  useSignTypedData: () => ({ signTypedData: walletSign.signTypedData, isPending: false }),
  // WalletConnect, the one connector (its modal opens on connect).
  useConnect: () => ({ connectors: [{ id: "walletConnect" }], connect: vi.fn(), isPending: false }),
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

// Your signature for one action: what a page puts above its signer groups.
const panel = (
  shown: never,
  state: Record<string, unknown> = { status: "open" },
  execution?: never
) => (
  <YourSignature
    hint="Check what it does below."
    actions={[
      { key: "council", title: "Council approval", set: shown, state: state as never, execution },
    ]}
  />
);

beforeEach(() => {
  wallet.address = undefined;
  root.read = true;
});

describe("SignatureSetCard", () => {
  it("shows each member's verdict and how many signatures are still needed", () => {
    render(
      <SignatureSetCard title="Security Council approval" set={set} state={{ status: "open" }} />
    );
    expect(screen.getByTestId("signature-count")).toHaveTextContent("1 signature · 2 required");
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

  it("Your signature: asks a visitor to connect, says a Safe is not a member, and lets only a member Safe sign; the signer groups never offer it", () => {
    const view = () => (
      <>
        {panel(set)}
        <SignatureSetCard title="t" set={set} state={{ status: "open" }} />
      </>
    );
    const { rerender } = render(view());
    expect(screen.getByTestId("your-signature-note")).toHaveTextContent(
      "Open for signatures: Council approval 1 of 2. Members connect their Safe to sign."
    );
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();

    wallet.address = "0x9999999999999999999999999999999999999999";
    rerender(view());
    expect(screen.getByTestId("your-signature-note")).toHaveTextContent(
      "not a member of the Security Council, so nothing to sign here."
    );
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();

    wallet.address = MEMBER_C;
    rerender(view());
    expect(screen.getByTestId("sign-button")).toBeEnabled();
    expect(screen.getByTestId("sign-button")).toHaveTextContent("Review and sign");
    expect(screen.getByTestId("my-status")).toHaveTextContent("Not signed yet · 1 of 2 so far");

    wallet.address = MEMBER_B;
    rerender(view());
    expect(screen.getByTestId("my-status")).toHaveTextContent(
      "1 of 2 of your Safe's owners signed"
    );
    expect(screen.getByTestId("sign-button")).toBeEnabled();

    wallet.address = MEMBER_A;
    rerender(view());
    expect(screen.getByTestId("my-status")).toHaveTextContent("Your signature is verified");
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
  });

  it("Your signature: a member Safe is asked to sign exactly the typed data shown, and nothing else", () => {
    wallet.address = MEMBER_C;
    walletSign.signTypedData.mockClear();
    render(panel(set));
    fireEvent.click(screen.getByTestId("sign-button"));
    fireEvent.click(screen.getByTestId("confirm-sign"));
    expect(walletSign.signTypedData).toHaveBeenCalledTimes(1);
    expect(walletSign.signTypedData.mock.calls[0]?.[0]).toEqual({
      domain: {
        name: "SecurityCouncil",
        version: "1",
        chainId: 1,
        verifyingContract: "0x59195219d1176E42f8e607e9AC114926D47f9035",
      },
      types: { ApproveUpgradeSecurityCouncil: [{ name: "id", type: "bytes32" }] },
      primaryType: "ApproveUpgradeSecurityCouncil",
      message: { id: `0x${"1".repeat(64)}` },
    });
  });

  it("renders its members at once before the root status is read, and lets no one sign yet", () => {
    root.read = false;
    wallet.address = MEMBER_C;
    render(
      <>
        {panel(set)}
        <SignatureSetCard title="t" set={set} state={{ status: "open" }} />
      </>
    );
    expect(screen.getAllByTestId("member-row")).toHaveLength(3);
    // The connected Safe's hashes are in Your signature: that needs only the wallet.
    expect(screen.getByText(hashes.domainHash)).toBeInTheDocument();
    expect(screen.getByTestId("sign-button")).toBeDisabled();
    expect(screen.getByText("Reading the governance roles…")).toBeInTheDocument();
  });

  it("Your signature: a group at its threshold has a transaction anyone reviews and sends, with the simulation verdict", () => {
    render(
      panel(set, { status: "open" }, {
        to: MEMBER_A,
        data: "0x1234",
        value: "0",
        functionName: "approve",
        simulation: { status: "ok" },
      } as never)
    );
    expect(screen.getByTestId("send-row-council")).toHaveTextContent("threshold met");
    fireEvent.click(screen.getByTestId("review-send"));
    expect(screen.getByTestId("calldata")).toHaveTextContent("0x1234");
    expect(screen.getByTestId("simulation-ok")).toBeInTheDocument();
  });

  it("Your signature: sent from the review, the page stays and shows the transaction in the row", () => {
    wallet.address = MEMBER_A;
    const hash = `0x${"7".repeat(64)}`;
    walletSend.sendTransaction.mockImplementationOnce(
      (_tx: unknown, opts: { onSuccess: (hash: string) => void }) => opts.onSuccess(hash)
    );
    render(
      panel(set, { status: "open" }, {
        to: MEMBER_A,
        data: "0x1234",
        value: "0",
        functionName: "approve",
        simulation: { status: "ok" },
      } as never)
    );
    fireEvent.click(screen.getByTestId("review-send"));
    fireEvent.click(screen.getByTestId("send-transaction"));
    // The transaction shown, as it is shown.
    expect(walletSend.sendTransaction).toHaveBeenCalledWith(
      { to: MEMBER_A, data: "0x1234", value: 0n },
      expect.anything()
    );
    // The review closes; the row says where it went until the action shows as done.
    expect(screen.queryByTestId("calldata")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("send-row-council")).getByTestId("tx-sent")).toHaveTextContent(
      `Sent in ${hash} · this page shows it done once it is in a block. Its receipt`
    );
  });

  it("folds closed groups away beside a group still in play, and shows them on request", () => {
    render(
      <ApprovalGroups count={2} closed={1}>
        <SignatureSetCard
          testId="set-done"
          title="Security Council approval"
          set={set}
          state={{ status: "done", detail: "Approved by the Security Council", txHash: null }}
        />
        <SignatureSetCard
          testId="set-closed"
          title="Guardians approval"
          set={set}
          state={{ status: "closed", detail: "The upgrade was executed" }}
        />
      </ApprovalGroups>
    );
    expect(screen.getByTestId("set-done")).toBeVisible();
    expect(screen.getByTestId("set-closed")).not.toBeVisible();
    fireEvent.click(screen.getByTestId("toggle-closed"));
    expect(screen.getByTestId("set-closed")).toBeVisible();
    expect(screen.getByTestId("toggle-closed")).toHaveTextContent("Hide closed groups");
  });

  it("done in a transaction: its link, and when it was executed", () => {
    render(
      <SignatureSetCard
        title="t"
        set={set}
        state={{
          status: "done",
          detail: "Approved by the Security Council",
          txHash: `0x${"9".repeat(64)}`,
          at: "1792500000",
        }}
      />
    );
    expect(screen.getByTestId("done-summary")).toHaveTextContent("In 0x99999999");
    expect(screen.getByTestId("executed-on")).toHaveTextContent("Oct 20, 2026, 12:40 UTC");
  });

  it("nothing to sign once done, and no count said for it", () => {
    wallet.address = MEMBER_C;
    render(
      <>
        {panel(set, { status: "done", detail: "Approved by the Security Council", txHash: null })}
        <SignatureSetCard
          title="t"
          set={set}
          state={{ status: "done", detail: "Approved by the Security Council", txHash: null }}
          used={[{ signer: MEMBER_A, signature: "0xaa", matchesSafe: true }]}
        />
      </>
    );
    expect(screen.queryByTestId("your-signature")).not.toBeInTheDocument();
    // All it carried is Safe's copies: nothing to say about it.
    expect(screen.queryByTestId("used-differ")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
    // Done: today's Safe copies decide nothing, so no threshold line; never "signatures needed".
    expect(screen.queryByTestId("threshold-below")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("signature-count")).toHaveTextContent("2 signatures · 2 required");
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
    // A comparison that could not be made, and an accepted re-check: neither is a problem to show.
    expect(screen.queryByTestId("used-differ")).not.toBeInTheDocument();
    expect(screen.getByTestId("done-summary")).not.toHaveTextContent(/re-check|differ/i);
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
    expect(screen.getByText("No signatures needed")).toBeInTheDocument();
    expect(screen.queryByTestId("threshold-below")).not.toBeInTheDocument();
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
    expect(screen.queryByTestId("sign-button")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar").innerHTML).toContain("bg-green-700");
  });
});

describe("labels that follow the tab's beats", () => {
  const live = (value: Partial<LiveState>) => ({ ...INITIAL_LIVE, ...value });
  const head = (n: string) => ({ number: n, hash: "0x01", timestamp: "1" });
  const shown = (simulation: Record<string, unknown>, state: Partial<LiveState>) =>
    render(
      <LiveStateProvider value={live(state)}>
        <SimulationResult simulation={simulation as never} />
      </LiveStateProvider>
    );

  it("a simulation shows as current (in green) only at the head the app serves; one from an older block is said as of it", () => {
    const sim = { status: "ok", atBlock: "100", watch: { key: "sim:01", rev: "1" } };
    let view = shown(sim, { head: head("100") });
    expect(screen.getByTestId("simulation-ok")).toHaveTextContent("Simulated at block #100");
    view.unmount();
    // A new head served, and this result was not simulated there (yet, or its read failed).
    view = shown(sim, { head: head("101") });
    expect(screen.queryByTestId("simulation-ok")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulation-earlier")).toHaveTextContent(
      /Simulated at block #100: .* Not simulated at block #101 yet/
    );
    view.unmount();
    // Simulated again at the served head with the same result (the beat says so).
    view = shown(sim, { head: head("101"), simulatedAt: { "sim:01": "101" } });
    expect(screen.getByTestId("simulation-ok")).toHaveTextContent("Simulated at block #101");
    view.unmount();
    // Before the first beat (no served head known): as loaded.
    view = shown(sim, {});
    expect(screen.getByTestId("simulation-ok")).toBeInTheDocument();
    view.unmount();
    // A dev node ('latest'): as before.
    view = shown({ status: "ok" }, { head: head("101") });
    expect(screen.getByTestId("simulation-ok")).toHaveTextContent("against the latest block");
    view.unmount();
    // Not followed (a page's own one-off simulation): asks to simulate again.
    view = shown({ status: "ok", atBlock: "100" }, { head: head("102") });
    expect(screen.getByTestId("simulation-earlier")).toHaveTextContent("Simulate it again");
    view.unmount();
    // A revert names its block, and says when it is not the current one.
    view = shown(
      { status: "reverted", error: "Protocol frozen", atBlock: "100", watch: sim.watch },
      { head: head("101") }
    );
    expect(screen.getByTestId("simulation-reverted")).toHaveTextContent(
      /block #100: it would revert with Protocol frozen \(not simulated at the current block yet\)/
    );
  });

  it("the Era block label names the newer of the page's own Era head and the beat's for that item, never another item's", () => {
    const at = (n: string) => ({ number: n, readAt: new Date().toISOString() });
    let view = render(
      <LiveStateProvider value={live({ eraAt: { "l2:a:1": at("7100") } })}>
        <EraBlockNote watchKey="l2:a:1" fallback={at("7000")} />
      </LiveStateProvider>
    );
    expect(screen.getByTestId("era-block")).toHaveTextContent("ZKsync Era block #7,100");
    view.unmount();
    view = render(
      <LiveStateProvider value={live({ eraAt: { "l2:b:2": at("7200") } })}>
        <EraBlockNote watchKey="l2:a:1" fallback={at("7000")} />
      </LiveStateProvider>
    );
    expect(screen.getByTestId("era-block")).toHaveTextContent("ZKsync Era block #7,000");
    view.unmount();
    // The beat's head for this item is older than the page's own (a reload since): the page's.
    render(
      <LiveStateProvider value={live({ eraAt: { "l2:a:1": at("6900") } })}>
        <EraBlockNote watchKey="l2:a:1" fallback={at("7000")} />
      </LiveStateProvider>
    );
    expect(screen.getByTestId("era-block")).toHaveTextContent("ZKsync Era block #7,000");
  });

  it("the Safe check label shows the newer of the beat's report and the page's own (after Fetch signatures, a reload)", () => {
    const check = (secondsAgoChecked: number | null) => ({
      state: "watching" as const,
      checkedAt:
        secondsAgoChecked === null
          ? null
          : new Date(Date.now() - secondsAgoChecked * 1000).toISOString(),
      nextAt: new Date(Date.now() + 50_000).toISOString(),
      cadenceMs: 60_000,
      reason: null,
    });
    // Each built once: two reads of the clock can be a millisecond apart.
    const [older, recent, fifth, never] = [check(30), check(2), check(5), check(null)];
    expect(newerCheck(older, recent)?.checkedAt).toBe(recent.checkedAt);
    expect(newerCheck(recent, older)?.checkedAt).toBe(recent.checkedAt);
    expect(newerCheck(never, fifth)?.checkedAt).toBe(fifth.checkedAt);
    expect(newerCheck(null, fifth)).not.toBeNull();
    expect(newerCheck(undefined, null)).toBeNull();
    // On the card: the reloaded set's own check (2 s ago) over the last beat's (30 s ago).
    const open = {
      ...(set as unknown as Record<string, unknown>),
      verifiedAtBlock: "1005",
      watch: { key: "set:01", rev: "1" },
      safeCheck: check(2),
    } as never;
    render(
      <LiveStateProvider value={live({ checked: { "set:01": check(30) } })}>
        <SignatureSetCard title="Council" set={open} state={{ status: "open" }} />
      </LiveStateProvider>
    );
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(/Safe checked [1-3]s ago/);
  });
});

describe("a set the app did not verify at the head it serves now (a beat says which head it was)", () => {
  const live = (value: Partial<LiveState>) => ({ ...INITIAL_LIVE, ...value });
  const head = (n: string) => ({ number: n, hash: "0x01", timestamp: "1" });
  const metAt = (block: string, watch: { key: string; rev: string | null } | undefined) =>
    ({
      ...(set as unknown as Record<string, unknown>),
      valid: [
        { signer: MEMBER_A, signature: "0xaa" },
        { signer: MEMBER_B, signature: "0xbb" },
      ],
      members: [member(MEMBER_A, "valid"), member(MEMBER_B, "valid"), member(MEMBER_C, "missing")],
      thresholdCheck: { status: "met", checkedWith: "checkSignatures" },
      verifiedAtBlock: block,
      safeFetchedAt: new Date().toISOString(),
      stale: false,
      watch,
      safeCheck: null,
    }) as never;
  const execution = {
    to: MEMBER_A,
    data: "0x1234",
    value: "0",
    functionName: "approve",
    simulation: { status: "ok", atBlock: "1000" },
  } as never;
  const card = (shown: never, state: Partial<LiveState>) =>
    render(
      <LiveStateProvider value={live(state)}>
        {panel(shown, { status: "open" }, execution)}
        <SignatureSetCard title="Council" set={shown} state={{ status: "open" }} />
      </LiveStateProvider>
    );
  const watch = { key: "set:01", rev: "7" };

  it("setCurrency: current at the served head, or at a newer block the beats name for the content shown; behind otherwise", () => {
    const at = (block: string, w = watch as { key: string; rev: string | null } | undefined) => ({
      verifiedAtBlock: block,
      watch: w,
    });
    // Before the first beat: as loaded.
    expect(setCurrency(at("1000"), { head: null })).toEqual({ block: "1000", behind: null });
    expect(setCurrency(at("1000"), { head: head("1000") })).toEqual({
      block: "1000",
      behind: null,
    });
    // A newer head served, and the beat names no newer block for this content.
    expect(setCurrency(at("1000"), { head: head("1003"), verifiedAt: {} })).toEqual({
      block: "1000",
      behind: "1003",
    });
    // Verified again there with the same content.
    const again = { "set:01": { rev: "7", block: "1003" } };
    expect(setCurrency(at("1000"), { head: head("1003"), verifiedAt: again })).toEqual({
      block: "1003",
      behind: null,
    });
    // Named for other content (a revision the tab no longer shows): not this content's block.
    expect(
      setCurrency(at("1000", { key: "set:01", rev: "6" }), {
        head: head("1003"),
        verifiedAt: again,
      })
    ).toEqual({ block: "1000", behind: "1003" });
    // A page with a signature from its URL (no revision): never named, behind once a head passes.
    expect(
      setCurrency(at("1000", { key: "set:01", rev: null }), {
        head: head("1001"),
        verifiedAt: again,
      })
    ).toEqual({ block: "1000", behind: "1001" });
    // A dev node ('latest': no block), and a stale first answer (it says so itself): never.
    expect(setCurrency({ verifiedAtBlock: null, watch }, { head: head("9") })).toEqual({
      block: null,
      behind: null,
    });
    expect(
      setCurrency({ verifiedAtBlock: "1000", stale: true, watch }, { head: head("1003") })
    ).toMatchObject({ behind: null });
  });

  it("behind: as of its block, in no passing colour, with nothing to sign or send, and a way to check again", () => {
    wallet.address = MEMBER_C;
    card(metAt("1000", watch), { head: head("1003"), verifiedAt: {} });
    expect(screen.getByTestId("set-stale")).toHaveTextContent(
      "Verified at block #1,000 · not re-verified at #1,003"
    );
    expect(screen.getByTestId("set-stale")).toHaveTextContent("checked again at each new block");
    expect(screen.queryByTestId("threshold-met")).not.toBeInTheDocument();
    expect(screen.getByTestId("threshold-stale")).toHaveTextContent(
      "At block #1,000 the threshold was met"
    );
    expect(screen.getByRole("progressbar").innerHTML).not.toContain("bg-green-700");
    const rows = screen.getAllByTestId("member-row");
    expect(within(rows[0] as HTMLElement).getByText(/Valid at #1,000/)).toBeInTheDocument();
    for (const row of rows) expect(row.className).not.toMatch(/bg-(green|red)-50/);
    // Sign and Send (in Your signature) stay, disabled, saying why; your status as of its block.
    expect(screen.getByTestId("my-status")).toHaveTextContent("As of block #1,000: Not signed yet");
    expect(screen.getByTestId("my-status").className).not.toMatch(/green|red/);
    expect(screen.getByTestId("sign-button")).toBeDisabled();
    expect(screen.getAllByText(/Not verified at block #1,003 yet/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("send-blocked")).toHaveTextContent(
      "Not verified at block #1,003 yet"
    );
    fireEvent.click(screen.getByTestId("review-send"));
    expect(screen.getByTestId("send-transaction")).toBeDisabled();
    // An open set of Safes: Fetch signatures verifies it at the current head.
    expect(screen.getByTestId("fetch-signatures")).toBeInTheDocument();
  });

  it("verified again at the served head with the same content: current, named at that head", () => {
    wallet.address = MEMBER_C;
    card(metAt("1000", watch), {
      head: head("1003"),
      verifiedAt: { "set:01": { rev: "7", block: "1003" } },
    });
    expect(screen.queryByTestId("set-stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("set-freshness")).toHaveTextContent("Verified at block #1,003");
    expect(screen.getByTestId("threshold-met")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").innerHTML).toContain("bg-green-700");
    expect(screen.getByTestId("sign-button")).toBeEnabled();
    expect(screen.queryByTestId("send-blocked")).not.toBeInTheDocument();
  });

  it("a page with a signature from its URL is never followed: once a newer head is served it says so, and offers to check again", () => {
    card(metAt("1000", { key: "set:01", rev: null }), { head: head("1001") });
    expect(screen.getByTestId("set-stale")).toHaveTextContent(
      "Verified at block #1,000 · not re-verified at #1,001"
    );
    expect(screen.getByTestId("set-stale")).toHaveTextContent(
      "Check again to verify them at the current block"
    );
    expect(screen.queryByTestId("threshold-met")).not.toBeInTheDocument();
  });

  it("a set that can no longer be signed, behind: no passing colour either, and Check again", () => {
    render(
      <LiveStateProvider value={live({ head: head("1003") })}>
        <SignatureSetCard
          title="Council"
          set={metAt("1000", watch)}
          state={{ status: "closed", detail: "Closed" }}
        />
      </LiveStateProvider>
    );
    expect(screen.queryByTestId("threshold-met")).not.toBeInTheDocument();
    expect(screen.getByTestId("check-again")).toBeInTheDocument();
    expect(screen.queryByTestId("fetch-signatures")).not.toBeInTheDocument();
  });

  it("the page's own item (an upgrade's state) not read again at the served head: labelled as of its block, and its sets' Sign and Send wait, saying why", () => {
    wallet.address = MEMBER_C;
    const page = (notedAt: LiveState["notedAt"]) =>
      render(
        <LiveStateProvider
          value={live({
            head: head("1003"),
            verifiedAt: { "set:01": { rev: "7", block: "1003" } },
            notedAt,
          })}
        >
          <PageCurrency watchKey="upgrade:0x01" what="The upgrade's state">
            <NotReReadNote watchKey="upgrade:0x01" what="The state and timeline below" />
            {panel(metAt("1000", watch), { status: "open" }, execution)}
            <SignatureSetCard
              title="Council"
              set={metAt("1000", watch)}
              state={{ status: "open" }}
            />
          </PageCurrency>
        </LiveStateProvider>
      );
    const behind = page({ "upgrade:0x01": { rev: "3", block: "1001" } });
    expect(screen.getByTestId("not-reread")).toHaveTextContent(
      "As of block #1,001 · not re-read at #1,003"
    );
    expect(screen.getByTestId("sign-button")).toBeDisabled();
    expect(screen.getByTestId("sign-blocked")).toHaveTextContent(
      "The upgrade's state was not read at block #1,003 yet."
    );
    expect(screen.getByTestId("send-blocked")).toHaveTextContent(
      "The upgrade's state was not read at block #1,003 yet. Sending waits until it is read at the current block."
    );
    fireEvent.click(screen.getByTestId("review-send"));
    expect(screen.getByTestId("send-transaction")).toBeDisabled();
    behind.unmount();
    // Read again at the served head: nothing to say, and the set's own currency decides.
    page({ "upgrade:0x01": { rev: "3", block: "1003" } });
    expect(screen.queryByTestId("not-reread")).not.toBeInTheDocument();
    expect(screen.getByTestId("sign-button")).toBeEnabled();
    expect(screen.queryByTestId("send-blocked")).not.toBeInTheDocument();
  });

  it("contentCurrency: behind only for an item the beats name at a block before the served head", () => {
    const noted = { "list:upgrades": { rev: "2", block: "1001" } };
    expect(contentCurrency("list:upgrades", { head: null, notedAt: noted })).toEqual({
      block: "1001",
      behind: null,
    });
    expect(contentCurrency("list:upgrades", { head: head("1001"), notedAt: noted })).toEqual({
      block: "1001",
      behind: null,
    });
    expect(contentCurrency("list:upgrades", { head: head("1002"), notedAt: noted })).toEqual({
      block: "1001",
      behind: "1002",
    });
    // Not named (a reload on its way, no revision yet, a dev node): nothing said.
    expect(contentCurrency("list:freeze", { head: head("1002"), notedAt: noted })).toEqual({
      block: null,
      behind: null,
    });
    expect(contentCurrency(null, { head: head("1002"), notedAt: noted })).toEqual({
      block: null,
      behind: null,
    });
  });

  it("the Safe check label: paused with the tab's updates, never a countdown then", () => {
    const check = {
      state: "watching" as const,
      checkedAt: new Date(Date.now() - 50_000).toISOString(),
      nextAt: new Date(Date.now() + 70_000).toISOString(),
      cadenceMs: 120_000,
      reason: null,
    };
    const open = {
      ...(metAt("1000", watch) as Record<string, unknown>),
      safeCheck: check,
    } as never;
    const view = card(open, { head: head("1000"), failing: true });
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(
      /Safe checked (49|50)s ago · checks paused \(updates paused\)/
    );
    view.unmount();
    card(open, { head: head("1000") });
    expect(screen.getByTestId("set-freshness")).toHaveTextContent(/next check in/);
  });
});

describe("Your signature, scrolled past and after signing", () => {
  it("scrolled past, its first signature to give stays in a bar that opens the same review", () => {
    wallet.address = MEMBER_C;
    // The panel above the top of the screen.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (entries: unknown[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: false, boundingClientRect: { top: -400 } }]);
        }
        disconnect() {}
      }
    );
    try {
      const view = render(panel(set));
      expect(screen.getByTestId("action-bar")).toHaveTextContent("Council approval");
      expect(document.documentElement.style.getPropertyValue("--action-bar")).toBe("72px");
      fireEvent.click(screen.getByTestId("bar-sign"));
      expect(screen.getByText("Review before signing in your Safe")).toBeInTheDocument();
      view.unmount();
      // Gone with it: the toasts and the live note come back down.
      expect(document.documentElement.style.getPropertyValue("--action-bar")).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("once the Safe has the request", () => {
    const watched = { ...(set as Record<string, unknown>), watch: { key: "set:01", rev: "1" } };
    const checks = vi.fn();
    const signNow = () => {
      walletSign.signTypedData.mockImplementationOnce(
        (_data: unknown, opts: { onSuccess: () => void }) => opts.onSuccess()
      );
      fireEvent.click(screen.getByTestId("sign-button"));
      fireEvent.click(screen.getByTestId("confirm-sign"));
    };
    beforeEach(() => {
      wallet.address = MEMBER_C;
      checks.mockReset();
      vi.useFakeTimers();
      vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
        checks(url, JSON.parse(init.body));
        return new Response(JSON.stringify({ failed: 0 }), { status: 200 });
      });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("fetches its signatures at once and again, until Safe's service has the signature", async () => {
      const { rerender } = render(panel(watched as never));
      signNow();
      expect(screen.getByTestId("my-status")).toHaveTextContent(
        "Sent to your Safe · fetching its signature from Safe"
      );
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(checks).toHaveBeenCalledTimes(1);
      expect(checks).toHaveBeenCalledWith("/resources/safe-check", { key: "set:01" });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(checks).toHaveBeenCalledTimes(3);
      // Safe has it (one owner of two): where it stands now, said instead, and no more fetches.
      rerender(
        panel({
          ...watched,
          members: [
            member(MEMBER_A, "valid"),
            member(MEMBER_B, "collecting"),
            member(MEMBER_C, "collecting"),
          ],
        } as never)
      );
      expect(screen.getByTestId("my-status")).toHaveTextContent(
        "1 of 2 of your Safe's owners signed"
      );
      await act(() => vi.advanceTimersByTimeAsync(120_000));
      expect(checks).toHaveBeenCalledTimes(3);
    });

    it("after 2 minutes without it, says Safe's service does not list it yet, with Fetch again", async () => {
      render(panel(watched as never));
      signNow();
      await act(() => vi.advanceTimersByTimeAsync(120_000));
      expect(checks).toHaveBeenCalledTimes(9);
      expect(screen.getByTestId("my-status")).toHaveTextContent(
        "Sent to your Safe, but Safe's service does not list it yet. Fetch again"
      );
      fireEvent.click(screen.getByTestId("fetch-again"));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(checks).toHaveBeenCalledTimes(10);
    });
  });
});
