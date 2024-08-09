import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CreateEmergencyProposalModal } from "@/routes/app/emergency/_index/create-emergency-proposal-modal";
import type { Hex } from "viem";

const mockSubmit = vi.fn();

vi.mock("@remix-run/react", () => ({
  useFetcher: () => ({
    submit: mockSubmit,
  }),
}));

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: vi.fn(),
}));

describe("CreateEmergencyProposalModal", () => {
  const mockOnClose = vi.fn();
  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    errors: {},
    status: undefined,
    proposerAddress: "0x1234567890123456789012345678901234567890" as Hex,
    emergencyBoardAddress: "0x0011223344556677889900112233445566778899" as Hex,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the modal when isOpen is true", () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);
    expect(screen.getByText("Define Emergency Proposal")).toBeInTheDocument();
  });

  it("doesn't render the modal when isOpen is false", () => {
    render(<CreateEmergencyProposalModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText("Define Emergency Proposal")).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);
    const closeButton = screen.getByRole("button", { name: "" });
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("displays form fields correctly", () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Target address")).toBeInTheDocument();
    expect(screen.getByLabelText("Calldata")).toBeInTheDocument();
    expect(screen.getByText("Value (optional)")).toBeInTheDocument();
  });

  // TODO: Fix
  // These doesn't work because the interaction of remix.run Form

  it.skip("shows verification step when 'Verify' is clicked with valid data", async () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Test Proposal" } });
    fireEvent.change(screen.getByLabelText("Target address"), {
      target: { value: "0x1234567890123456789012345678901234567890" },
    });
    fireEvent.change(screen.getByLabelText("Calls"), { target: { value: "0x1234" } });
    fireEvent.change(screen.getByTestId("value-input"), { target: { value: "1" } });

    const verifyButton = screen.getByTestId("verify-button");
    expect(verifyButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(verifyButton);
    });

    await waitFor(
      () => {
        expect(screen.getByText("Emergency Proposal Details")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it.skip("submits the form when 'Create' is clicked in verification step", async () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Test Proposal" } });
    fireEvent.change(screen.getByLabelText("Target address"), {
      target: { value: "0x1234567890123456789012345678901234567890" },
    });
    fireEvent.change(screen.getByLabelText("Calls"), { target: { value: "0x1234" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "0" } });

    fireEvent.click(screen.getByText("Verify"));

    await waitFor(() => {
      fireEvent.click(screen.getByText("Create"));
    });

    expect(mockSubmit).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it.skip("displays error messages for invalid inputs", async () => {
    render(<CreateEmergencyProposalModal {...defaultProps} />);

    const verifyButton = screen.getByTestId("verify-button");
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByTestId("title-error")).toBeInTheDocument();
      expect(screen.getByText("Invalid Ethereum address")).toBeInTheDocument();
      expect(screen.getByText("Calls must be a hex string starting with 0x")).toBeInTheDocument();
    });
  });
});
