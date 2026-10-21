import { OverviewSummary } from "@/components/overview-summary";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

describe("OverviewSummary", () => {
  it("distinguishes an incomplete empty list from a confirmed zero", () => {
    render(<OverviewSummary count={0} label="open for signatures" incomplete />);
    expect(screen.getByText("List incomplete")).toBeInTheDocument();
    expect(screen.getByText(/some sources could not be read/)).toBeInTheDocument();
    expect(screen.queryByText("0 open for signatures")).not.toBeInTheDocument();
  });

  it("shows a confirmed zero when discovery completed", () => {
    const { container } = render(
      <OverviewSummary count={0} label="in progress" detail="1 upgrade in the last 45 days" />
    );
    expect(container).toHaveTextContent("0 in progress");
    expect(screen.getByText("1 upgrade in the last 45 days")).toBeInTheDocument();
    expect(screen.queryByText("List incomplete")).not.toBeInTheDocument();
  });

  it("tones a non-zero count only when it is current, and says each state in words", () => {
    const chip = (props: { count: number; emphasize?: boolean; tone?: "attention" | "active" }) => {
      const { unmount } = render(<OverviewSummary label="pending" {...props} />);
      const el = screen.getByTestId("count-chip");
      const out = {
        tone: el.dataset.tone,
        text: el.textContent,
        icon: el.querySelector("svg") !== null,
      };
      unmount();
      return out;
    };
    expect(chip({ count: 1, emphasize: true })).toEqual({
      tone: "attention",
      text: "1 pending",
      icon: true,
    });
    expect(chip({ count: 2, emphasize: true, tone: "active" })).toMatchObject({
      tone: "active",
      icon: true,
    });
    expect(chip({ count: 0, emphasize: true })).toEqual({
      tone: "none",
      text: "0 pending",
      icon: false,
    });
    // Older data (as last shown, the last run's history, old Safe copies): never toned.
    expect(chip({ count: 1 })).toMatchObject({ tone: "held", icon: false });
  });

  it("says where a count comes from: the contracts on chain, or signatures collected in Safe", () => {
    const { unmount } = render(
      <OverviewSummary count={1} label="in progress" from="chain" emphasize />
    );
    expect(screen.getByTestId("counted-from")).toHaveTextContent("On-chain");
    unmount();
    render(<OverviewSummary count={1} label="pending" from="safe" emphasize />);
    expect(screen.getByTestId("counted-from")).toHaveTextContent("In Safe");
    expect(screen.getByTestId("counted-from")).toHaveAttribute(
      "title",
      expect.stringContaining("checked on chain")
    );
  });
});
