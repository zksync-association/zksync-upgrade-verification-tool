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
});
