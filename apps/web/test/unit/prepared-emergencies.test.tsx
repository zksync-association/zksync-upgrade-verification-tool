import { PreparedEmergencies } from "@/components/verification/prepared-emergencies";
import { forgetPayload, listPayloads, loadPayload, savePayload } from "@/utils/payload-storage";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("remix-routes", () => ({ $path: () => "/" }));

const ID_A = `0x${"a".repeat(64)}`;
const ID_B = `0x${"b".repeat(64)}`;
const ID_C = `0x${"c".repeat(64)}`;
const payload = (title: string, calls = 1) => ({
  title,
  executor: "0x0000000000000000000000000000000000000001",
  salt: `0x${"0".repeat(64)}`,
  calls: Array.from({ length: calls }, () => ({ target: "0x0", value: "0", data: "0x" })),
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("emergency payloads kept in this browser", () => {
  it("are kept after the tab is gone (localStorage), with when they were first prepared here", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    savePayload(ID_A, payload("Fix"));
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    // Loaded again (the same id is the same payload): its time stays.
    savePayload(ID_A, payload("Fix"));
    expect(loadPayload(ID_A.toUpperCase().replace("0X", "0x"))).toEqual(payload("Fix"));
    expect(listPayloads()).toEqual([{ id: ID_A, payload: payload("Fix"), savedAt: 1_000 }]);
    expect(sessionStorage.length).toBe(0);
  });

  it("move a tab-only copy (sessionStorage, the bare payload) to the ones kept, listed newest first", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    savePayload(ID_A, payload("Older"));
    sessionStorage.setItem(`emergency-payload:${ID_B}`, JSON.stringify(payload("From a tab")));
    vi.spyOn(Date, "now").mockReturnValue(3_000);
    expect(listPayloads().map((p) => [p.id, p.savedAt])).toEqual([
      [ID_B, 3_000],
      [ID_A, 2_000],
    ]);
    expect(sessionStorage.length).toBe(0);
    expect(loadPayload(ID_B)).toEqual(payload("From a tab"));
    forgetPayload(ID_B);
    expect(listPayloads().map((p) => p.id)).toEqual([ID_A]);
  });
});

describe("Prepared in this browser", () => {
  const saved = [
    { id: ID_A, payload: payload("Fix the bridge", 2), savedAt: Date.UTC(2026, 9, 19, 14, 5) },
    { id: ID_B, payload: payload(""), savedAt: Date.UTC(2026, 9, 18) },
    { id: ID_C, payload: payload("Done"), savedAt: Date.UTC(2026, 9, 1) },
  ];
  const summary = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      executed: null,
      reported: { securityCouncil: 3, guardians: 1, zkFoundation: false },
      firstSeen: null,
      ...extra,
    }) as never;

  it("lists each before anyone signs, and where each stands once the lists are read", () => {
    const { rerender } = render(<PreparedEmergencies saved={saved} onRemoved={() => {}} />);
    const rows = () => screen.getAllByTestId("prepared-row");
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveTextContent("Fix the bridge");
    expect(rows()[0]).toHaveTextContent("Prepared here Oct 19, 2026, 14:05 UTC · 2 calls");
    expect(rows()[1]).toHaveTextContent("Untitled emergency upgrade");
    for (const row of rows())
      expect(within(row).getByTestId("prepared-status")).toHaveTextContent(
        "Checking members' Safes…"
      );

    rerender(
      <PreparedEmergencies
        saved={saved}
        onRemoved={() => {}}
        pending={[summary(ID_A)]}
        executed={[
          summary(ID_C, { executed: { txHash: `0x${"d".repeat(64)}`, blockNumber: "10" } }),
        ]}
      />
    );
    const status = (i: number) => within(rows()[i] as HTMLElement).getByTestId("prepared-status");
    expect(status(0)).toHaveTextContent("Security Council 3Guardians 1Foundation pending");
    expect(status(1)).toHaveTextContent("No signatures pending in members' Safes");
    expect(status(2)).toHaveTextContent("Executed");
  });

  it("removes one from this browser only once confirmed", () => {
    savePayload(ID_A, payload("Fix"));
    const onRemoved = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<PreparedEmergencies saved={listPayloads()} onRemoved={onRemoved} />);
    fireEvent.click(screen.getByTestId("prepared-remove"));
    expect(confirm).toHaveBeenCalled();
    expect(loadPayload(ID_A)).not.toBeNull();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("prepared-remove"));
    expect(loadPayload(ID_A)).toBeNull();
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });
});
