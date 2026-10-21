import { UPGRADE_STATES } from "@/common/upgrade-states";
import { Timeline } from "@/components/verification/timeline";
import { upgradeSteps } from "@/components/verification/upgrade-steps";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";

// A standard upgrade's timeline assumes the Security Council path; the Guardians' path shows only
// once they took it.

const DAY = 86_400;
const created = 1_792_582_860; // Oct 21, 2026, 11:41 UTC
const timeline = {
  createdAt: created,
  legalVetoEndsAt: created + 3 * DAY,
  waitingEndsAt: created + 33 * DAY,
  approvedAt: null as number | null,
  readyAt: null as number | null,
  delaySeconds: DAY,
};
const view = (
  state: number,
  t: Partial<typeof timeline> = {},
  extra: { guardiansApproved?: boolean } = {}
) =>
  render(
    <Timeline
      now={created + DAY}
      steps={upgradeSteps({
        state,
        timeline: { ...timeline, ...t },
        legalVetoExtended: false,
        guardiansApproved: extra.guardiansApproved ?? false,
        now: created + DAY,
      })}
    />
  );
// Each step's text, without the number in its circle (a step not reached yet).
const steps = () =>
  screen.getAllByRole("listitem").map((li) => (li.textContent ?? "").replace(/^\d/, ""));

describe("a standard upgrade's timeline", () => {
  it("in the legal veto: the Security Council's approval from its end, ready a day after it", () => {
    view(UPGRADE_STATES.LegalVetoPeriod);
    expect(steps()).toEqual([
      "Started on L1Oct 21, 2026, 11:41 UTC",
      "Legal veto periodOct 24, 2026, 11:41 UTC",
      "Security Council approvalFrom Oct 24, 2026, 11:41 UTC",
      "Ready to execute1 day after approval",
      "Executed",
    ]);
    expect(screen.queryByText(/Guardians|30 days/)).toBeNull();
  });

  it("waiting: the approval is due by the end of the 30 days", () => {
    view(UPGRADE_STATES.Waiting);
    expect(steps()[2]).toBe("Security Council approvalDue by Nov 23, 2026, 11:41 UTC");
  });

  it("approved: when, and when it is ready (none on a testnet handler)", () => {
    const approvedAt = created + 4 * DAY;
    view(UPGRADE_STATES.ExecutionPending, { approvedAt, readyAt: approvedAt + DAY });
    expect(steps()[2]).toBe("Approved by the Security CouncilOct 25, 2026, 11:41 UTC");
    expect(steps()[3]).toBe("Ready to executeOct 26, 2026, 11:41 UTC");
  });

  it("names the Guardians only once they approved, and an upgrade nobody approved in time", () => {
    const { unmount } = view(UPGRADE_STATES.Waiting, {}, { guardiansApproved: true });
    expect(steps()[2]).toBe("Approved by the GuardiansTakes effect Nov 23, 2026, 11:41 UTC");
    unmount();
    view(UPGRADE_STATES.Expired);
    expect(steps()[2]).toBe("Not approved in timeNov 23, 2026, 11:41 UTC");
    expect(steps()[3]).toBe("Ready to execute");
  });

  it("on a testnet handler (no delay), ready once approved", () => {
    view(UPGRADE_STATES.Waiting, { delaySeconds: 0 });
    expect(steps()[3]).toBe("Ready to executeOnce approved");
  });
});
