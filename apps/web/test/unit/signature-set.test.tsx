import { SignatureSetCard } from "@/components/verification/signature-set";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));

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
  });
});
