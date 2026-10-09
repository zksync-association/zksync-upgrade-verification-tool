import type { SafeCheck } from "@/.server/safe/store";
import { INITIAL_LIVE, type LiveState, LiveStateProvider } from "@/components/presence";
import { safeUnavailableReason } from "@/components/verification/freshness";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A signature set card while Safe cannot be read (its checks paused, its monthly quota used up,
// no Safe key, members it did not answer for), across several heads: the card keeps the reason,
// never says it is "checked again at each new block", does not flip between current and behind
// at each head, and Fetch signatures and Sign keep their places.

const wallet = vi.hoisted(() => ({ address: undefined as string | undefined }));

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
    useStatus: status,
    useStatusIfRead: status,
  };
});
vi.mock("@remix-run/react", () => ({
  useRouteLoaderData: () => ({ status: { ok: true } }),
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
const member = (address: string, status: string) => ({
  member: address,
  label: null,
  safe: {
    address: "",
    isContract: true,
    version: "1.3.0",
    threshold: 2,
    owners: [],
    domainSeparatorMatches: true,
  },
  hashes,
  status,
  source: status === "valid" ? "safe" : null,
  signature: status === "valid" ? "0xaa" : null,
  owners: [],
  confirmations: status === "valid" ? 2 : 0,
  signedAt: null,
  error: null,
  safeWalletUrl: null,
});

const QUOTA_MESSAGE =
  "Safe Transaction Service monthly quota exhausted. Signature copies are unavailable until the quota resets or service access is updated.";
const watch = { key: "set:01", rev: "7" };

/** An open set (1 of 2 valid) verified at `block`; `others`: the status of members B and C. */
function openSet(block: string, others: string, extra: Record<string, unknown> = {}) {
  return {
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
    members: [member(MEMBER_A, "valid"), member(MEMBER_B, others), member(MEMBER_C, others)],
    valid: [{ signer: MEMBER_A, signature: "0xaa" }],
    thresholdCheck: { status: "below", valid: 1, threshold: 2 },
    safeApiError: null,
    verifiedAtBlock: block,
    safeFetchedAt: new Date(Date.now() - 300_000).toISOString(),
    stale: false,
    watch,
    ...extra,
  } as never;
}

const paused = (reason: string): SafeCheck => ({
  state: "paused",
  checkedAt: new Date(Date.now() - 300_000).toISOString(),
  nextAt: null,
  cadenceMs: null,
  reason,
});
const onRequest: SafeCheck = {
  state: "on-request",
  checkedAt: new Date(Date.now() - 300_000).toISOString(),
  nextAt: null,
  cadenceMs: null,
  reason: null,
};
const watching: SafeCheck = {
  state: "watching",
  checkedAt: new Date(Date.now() - 5_000).toISOString(),
  nextAt: new Date(Date.now() + 55_000).toISOString(),
  cadenceMs: 60_000,
  reason: null,
};

const head = (n: number) => ({ number: String(n), hash: "0x01", timestamp: "1" });
const live = (value: Partial<LiveState>): LiveState => ({ ...INITIAL_LIVE, ...value });
const execution = {
  to: MEMBER_A,
  data: "0x1234",
  value: "0",
  functionName: "approve",
  simulation: { status: "ok", atBlock: "1000" },
} as never;

function Card({ shown, state }: { shown: never; state: LiveState }) {
  return (
    <LiveStateProvider value={state}>
      <SignatureSetCard
        title="Council"
        set={shown}
        state={{ status: "open" }}
        execution={execution}
        testId="card"
      />
    </LiveStateProvider>
  );
}

/** The Sign control: the member's Sign button, or Connect for a visitor. */
const signControl = () =>
  screen.queryByTestId("sign-button") ??
  screen.getByRole("button", { name: /Connect your Safe to sign/ });

beforeEach(() => {
  wallet.address = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a set whose Safe copies cannot be used now, across several heads", () => {
  it("Safe cooling down (monthly quota used up), the engine verifying the set at each head with its members unavailable: current at every head, never behind, the reason kept in its line", () => {
    // What a request and the engine both give during the cooldown (signatures.ts pageSource):
    // the members unavailable, the error said, verified at each head (the beats name it).
    const shown = openSet("1000", "unavailable", {
      safeApiError: QUOTA_MESSAGE,
      safeCheck: paused("quota-exhausted"),
    });
    const check = { "set:01": paused("quota-exhausted") };
    const { rerender } = render(
      <Card shown={shown} state={live({ head: head(1000), checked: check })} />
    );
    const fetch = screen.getByTestId("fetch-signatures");
    const sign = signControl();
    for (let n = 1001; n <= 1006; n++) {
      rerender(
        <Card
          shown={shown}
          state={live({
            head: head(n),
            checked: check,
            verifiedAt: { "set:01": { rev: "7", block: String(n) } },
          })}
        />
      );
      expect(screen.getByTestId("card")).not.toHaveAttribute("data-stale");
      expect(screen.queryByTestId("set-stale")).not.toBeInTheDocument();
      expect(screen.getByTestId("set-freshness")).toHaveTextContent(
        `Verified at block #${n.toLocaleString("en-US")}`
      );
      expect(screen.getByTestId("set-freshness")).toHaveTextContent(
        "checks paused (Safe's monthly quota used up)"
      );
      expect(screen.getByTestId("card")).not.toHaveTextContent("checked again at each new block");
      // Incomplete, never a definitive shortfall, with Safe's error said.
      expect(screen.getByTestId("signature-count")).toHaveTextContent(
        "1 verified · check incomplete"
      );
      expect(screen.getByText(/monthly quota exhausted/)).toBeInTheDocument();
      // The same controls, never remounted.
      expect(screen.getByTestId("fetch-signatures")).toBe(fetch);
      expect(signControl()).toBe(sign);
    }
  });

  it.each([
    [
      "its checks paused (hourly budget used)",
      paused("budget"),
      "valid-less",
      "Safe checks paused (hourly budget used)",
    ],
    [
      "its checks paused (Safe quota low)",
      paused("quota"),
      "valid-less",
      "Safe checks paused (Safe quota low)",
    ],
    [
      "Safe's monthly quota used up",
      paused("quota-exhausted"),
      "valid-less",
      "Safe unavailable (Safe's monthly quota used up)",
    ],
    ["Safe rate limited", paused("cooldown"), "valid-less", "Safe unavailable (Safe rate limit)"],
    [
      "no Safe key (read only on request)",
      onRequest,
      "valid-less",
      "Safe read only on request (no Safe key)",
    ],
    [
      "Safe not answering for two members",
      watching,
      "unavailable",
      "Safe did not answer for 2 members",
    ],
  ])(
    "%s, the engine leaving the set to the next request: behind at every newer head (no flip back), the reason and Fetch signatures to retry in its label, never 'checked again at each new block'; Sign says why as text; Fetch and Sign keep their places",
    (_what, check, others, reason) => {
      const shown = openSet("1000", others === "valid-less" ? "missing" : others, {
        safeCheck: check,
      });
      const checked = { "set:01": check };
      const { rerender } = render(
        <Card shown={shown} state={live({ head: head(1000), checked })} />
      );
      // Current at its own block.
      expect(screen.queryByTestId("set-stale")).not.toBeInTheDocument();
      const fetch = screen.getByTestId("fetch-signatures");
      const sign = signControl();
      for (let n = 1001; n <= 1005; n++) {
        // The beats name no newer block for this content: the engine skipped it.
        rerender(<Card shown={shown} state={live({ head: head(n), checked, verifiedAt: {} })} />);
        const at = n.toLocaleString("en-US");
        expect(screen.getByTestId("card")).toHaveAttribute("data-stale", "true");
        const label = screen.getByTestId("set-stale");
        expect(label).toHaveTextContent(
          `Verified at block #1,000 · not re-verified at #${at} · ${reason}`
        );
        expect(label).toHaveTextContent("Fetch signatures to retry");
        expect(label).not.toHaveTextContent("checked again at each new block");
        // Sign is disabled, and why is said as text (a phone has no tooltip).
        expect(signControl()).toBeDisabled();
        expect(screen.getByTestId("sign-blocked")).toHaveTextContent(
          `Not verified at block #${at} yet.`
        );
        expect(screen.getByTestId("send-blocked")).toHaveTextContent(
          `Not verified at block #${at} yet.`
        );
        expect(screen.getByTestId("fetch-signatures")).toBe(fetch);
        expect(signControl()).toBe(sign);
      }
    }
  );

  it("the reason holds for a member's Sign button too (a connected member Safe)", () => {
    wallet.address = MEMBER_C;
    const shown = openSet("1000", "missing", { safeCheck: paused("quota-exhausted") });
    render(<Card shown={shown} state={live({ head: head(1003), verifiedAt: {} })} />);
    expect(screen.getByTestId("sign-button")).toBeDisabled();
    expect(screen.getByTestId("sign-blocked")).toHaveTextContent(
      "Not verified at block #1,003 yet."
    );
  });

  it("behind for another reason (its reads failed while Safe is watched as usual): still says it is checked again at each new block", () => {
    const shown = openSet("1000", "missing", { safeCheck: watching });
    render(<Card shown={shown} state={live({ head: head(1002), verifiedAt: {} })} />);
    const label = screen.getByTestId("set-stale");
    expect(label).toHaveTextContent("Verified at block #1,000 · not re-verified at #1,002");
    expect(label).toHaveTextContent("checked again at each new block");
    expect(label).not.toHaveTextContent("Fetch signatures to retry");
  });

  it("no Fetch signatures on the card (its members are not Safes): never tells the viewer to press it", () => {
    const base = openSet("1000", "missing", { safeCheck: paused("quota-exhausted") }) as {
      members: { safe: Record<string, unknown> }[];
    };
    const shown = {
      ...base,
      members: base.members.map((m) => ({ ...m, safe: { ...m.safe, isContract: false } })),
    } as never;
    render(<Card shown={shown} state={live({ head: head(1002), verifiedAt: {} })} />);
    expect(screen.queryByTestId("fetch-signatures")).not.toBeInTheDocument();
    expect(screen.getByTestId("check-again")).toBeInTheDocument();
    expect(screen.getByTestId("set-stale")).not.toHaveTextContent("Fetch signatures to retry");
  });

  it("safeUnavailableReason: a reason only for a check that cannot read Safe now, or members Safe did not answer for", () => {
    expect(safeUnavailableReason(paused("quota-exhausted"), 0)).toBe(
      "Safe unavailable (Safe's monthly quota used up)"
    );
    expect(safeUnavailableReason(paused("cooldown"), 0)).toBe("Safe unavailable (Safe rate limit)");
    expect(safeUnavailableReason(paused("budget"), 0)).toBe(
      "Safe checks paused (hourly budget used)"
    );
    expect(safeUnavailableReason(paused("something-new"), 0)).toBe(
      "Safe checks paused (checks paused)"
    );
    expect(safeUnavailableReason(onRequest, 0)).toBe("Safe read only on request (no Safe key)");
    expect(safeUnavailableReason(watching, 1)).toBe("Safe did not answer for 1 member");
    expect(safeUnavailableReason(watching, 0)).toBeNull();
    expect(safeUnavailableReason(null, 0)).toBeNull();
  });

  it("Fetch signatures keeps its slot: before the label on a phone, at the top right from sm up, and what a press found goes below the button, which is never remounted", async () => {
    // A press that finds Safe not answering for 2 members.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ failed: 2 }), { status: 200 }))
    );
    const shown = openSet("1000", "missing", { safeCheck: paused("quota-exhausted") });
    const { rerender } = render(
      <Card shown={shown} state={live({ head: head(1000), checked: {} })} />
    );
    const button = screen.getByTestId("fetch-signatures");
    const slot = button.parentElement as HTMLElement;
    const row = slot.parentElement as HTMLElement;
    // The label is the row's first child in the DOM: on a phone the row is reversed (the button
    // above it), from sm up a row aligned at the top (the label's height never moves it).
    expect(row.className).toMatch(/(^| )flex-col-reverse( |$)/);
    expect(row.className).toMatch(/(^| )sm:flex-row( |$)/);
    expect(row.className).toMatch(/(^| )sm:items-start( |$)/);
    expect(row.firstElementChild).not.toBe(slot);
    expect(row.lastElementChild).toBe(slot);
    // The button first in its own slot, the press's outcome under it.
    expect(slot.firstElementChild).toBe(button);
    await act(async () => {
      fireEvent.click(button);
    });
    const found = await screen.findByText("Safe did not answer for 2 members");
    expect(slot.firstElementChild).toBe(button);
    expect(button.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Behind at the next head: the same button in the same slot.
    rerender(<Card shown={shown} state={live({ head: head(1001), verifiedAt: {} })} />);
    expect(screen.getByTestId("set-stale")).toBeInTheDocument();
    expect(screen.getByTestId("fetch-signatures")).toBe(button);
    expect(button.parentElement).toBe(slot);
    expect(slot.firstElementChild).toBe(button);
    expect(row.lastElementChild).toBe(slot);
  });
});
