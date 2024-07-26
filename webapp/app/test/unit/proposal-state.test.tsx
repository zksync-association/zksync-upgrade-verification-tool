import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import "@testing-library/jest-dom";
import ProposalState from "@/routes/app/proposals/$id/proposal-state";
import { PROPOSAL_STATES } from "@/utils/proposal-states";

vi.mock("remix-routes", () => ({
  $path: () => "/",
}));

describe("ProposalState", () => {
  it("does not add times when times is null", async () => {
    render(<ProposalState status={PROPOSAL_STATES.LegalVetoPeriod} times={null} />);

    const element = await screen.findByText(/LEGAL VETO PERIOD/);
    expect(element).toBeInTheDocument();
    expect(element).toHaveClass("text-yellow-400");
    expect(element).toHaveTextContent(/^LEGAL VETO PERIOD$/);
  });

  it("adds the time when they are present", async () => {
    render(
      <ProposalState
        status={PROPOSAL_STATES.LegalVetoPeriod}
        times={{ currentDay: 6, totalDays: 13 }}
      />
    );

    const element = await screen.findByText(/LEGAL VETO PERIOD/);
    expect(element).toBeInTheDocument();
    expect(element).toHaveClass("text-yellow-400");
    expect(element).toHaveTextContent(/^LEGAL VETO PERIOD \(day 6 out of 13\)$/);
  });
});
