import { GovernanceContext, type OkStatus, useStatus } from "@/components/governance-context";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

function StatusConsumer() {
  const status = useStatus();
  return <p>{status.governance.network.label}</p>;
}

it("never turns absent/pending governance into a usable status", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => render(<StatusConsumer />)).toThrow("App status unavailable");
  } finally {
    error.mockRestore();
  }
});

it("provides the resolved governance snapshot to page and wallet consumers", () => {
  const status = {
    ok: true,
    governance: { network: { label: "Verified test network" } },
  } as OkStatus;
  render(
    <GovernanceContext.Provider value={status}>
      <StatusConsumer />
    </GovernanceContext.Provider>
  );
  expect(screen.getByText("Verified test network")).toBeInTheDocument();
});
