import { SignatureSetCard } from "@/components/verification/signature-set";
import { UntilFresh } from "@/components/verification/until-fresh";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A reload in place must not reset what the viewer opened. It can flip whether a set's first
// answer was stale or already current; the cards' tree is the same either way (UntilFresh always
// renders a Suspense around an Await), so React keeps them mounted.

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));
const MEMBER_A = "0x1000000000000000000000000000000000000001";
const MEMBER_B = "0x2000000000000000000000000000000000000002";

vi.mock("@/components/governance-context", async (importOriginal) => {
  const status = () => ({
    ok: true,
    governance: {
      network: { explorerUrl: "https://etherscan.io", l2ExplorerUrl: null },
      securityCouncil: { members: [MEMBER_A, MEMBER_B] },
      guardians: { members: [] },
      emergencyUpgradeBoard: { zkFoundation: "0x0000000000000000000000000000000000000009" },
    },
  });
  return {
    ...(await importOriginal<typeof import("@/components/governance-context")>()),
    useStatus: status,
    useStatusIfRead: status,
  };
});
vi.mock("@remix-run/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remix-run/react")>()),
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

const hashes = {
  domainHash: `0x${"d".repeat(64)}`,
  messageHash: `0x${"e".repeat(64)}`,
  safeMessageHash: `0x${"f".repeat(64)}`,
};
const member = (address: string, status: string) => ({
  member: address,
  label: null,
  safe: {
    address,
    isContract: true,
    version: "1.3.0",
    threshold: 1,
    owners: [],
    domainSeparatorMatches: true,
  },
  hashes,
  status,
  source: status === "missing" ? null : "safe",
  signature: status === "missing" ? null : "0xaa",
  owners: [],
  confirmations: status === "missing" ? null : 1,
  signedAt: null,
  error: null,
  safeWalletUrl: null,
});
const set = (stale: boolean, verifiedAtBlock: string) =>
  ({
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
    members: [member(MEMBER_A, "valid"), member(MEMBER_B, "missing")],
    valid: [{ signer: MEMBER_A, signature: "0xaa" }],
    thresholdCheck: { status: "below", valid: 1, threshold: 2 },
    safeApiError: null,
    verifiedAtBlock,
    stale,
  }) as never;

/** A deferred value the router already awaited (what a reload hands the page). */
const settled = <T,>(value: T) =>
  Object.assign(Promise.resolve(value), { _tracked: true, _data: value }) as Promise<T>;

function page(first: ReturnType<typeof set>, fresh: Promise<unknown> | null) {
  return (
    <UntilFresh stale={(first as { stale: boolean }).stale} fresh={fresh}>
      {(current, refresh) => (
        <SignatureSetCard
          title="Security Council approval"
          set={(current ?? first) as never}
          state={{ status: "open" }}
          refresh={refresh}
        />
      )}
    </UntilFresh>
  );
}

beforeEach(() => {
  wallet.address = undefined;
});

describe("a set card through a reload of the page", () => {
  it("keeps an expanded member row, 'What members sign' and the members list as the viewer left them, whichever way the first answer flips", () => {
    // First load: the first answer was an older block's; the current one came in.
    const view = render(page(set(true, "100"), settled(set(false, "101"))));
    expect(screen.getByText(/Verified at block #101/)).toBeInTheDocument();
    // The viewer expands B's row and "What members sign", and closes the members list.
    fireEvent.click(screen.getByText(MEMBER_B));
    fireEvent.click(screen.getByText(/What members sign/));
    expect(screen.getByText("A hardware wallet signing for this Safe shows")).toBeInTheDocument();
    expect(screen.getByText("EIP-712 digest")).toBeInTheDocument();
    const details = screen.getByText(/Current member signatures/).closest("details");
    (details as HTMLDetailsElement).open = false;

    // A reload at the next block: this time the first answer is already the current result.
    view.rerender(page(set(false, "102"), null));
    expect(screen.getByText(/Verified at block #102/)).toBeInTheDocument();
    expect(screen.getByText("A hardware wallet signing for this Safe shows")).toBeInTheDocument();
    expect(screen.getByText("EIP-712 digest")).toBeInTheDocument();
    expect(
      (screen.getByText(/Current member signatures/).closest("details") as HTMLDetailsElement).open
    ).toBe(false);

    // And back: an older first answer again, the current one in.
    view.rerender(page(set(true, "102"), settled(set(false, "103"))));
    expect(screen.getByText(/Verified at block #103/)).toBeInTheDocument();
    expect(screen.getByText("A hardware wallet signing for this Safe shows")).toBeInTheDocument();
    expect(screen.getByText("EIP-712 digest")).toBeInTheDocument();
  });

  it("keeps an open Sign dialog open", () => {
    wallet.address = MEMBER_B;
    const view = render(page(set(false, "100"), null));
    fireEvent.click(screen.getByTestId("sign-button"));
    expect(screen.getByText("Review before signing in your Safe")).toBeInTheDocument();
    view.rerender(page(set(true, "100"), settled(set(false, "101"))));
    expect(screen.getByText("Review before signing in your Safe")).toBeInTheDocument();
    view.rerender(page(set(false, "102"), null));
    expect(screen.getByText("Review before signing in your Safe")).toBeInTheDocument();
  });
});
