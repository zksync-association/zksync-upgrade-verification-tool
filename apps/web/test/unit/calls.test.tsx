import { decodeCall } from "@/common/proposal";
import { CallList } from "@/components/verification/calls";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { concat, encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

const abi = parseAbi(["function approve(address spender, uint256 amount)"]);
const target = "0x66A5cFB2e9c529f14FE6364Ad1075dF3a649C0A5" as const;
const data = encodeFunctionData({
  abi,
  functionName: "approve",
  args: ["0x8829AD80E425C646DAB305381ff105169FeEcE56", 5n],
});

describe("CallList", () => {
  it("shows a decoded call as a row without a note: decoded means it re-encodes exactly", () => {
    render(<CallList calls={[decodeCall({ target, value: "0", data })]} />);
    expect(screen.getByText("approve(..)")).toBeInTheDocument();
    expect(screen.getByText("Token")).toBeInTheDocument();
    expect(screen.getByText("2 params")).toBeInTheDocument();
    expect(screen.queryByTestId("not-exact")).toBeNull();
    expect(screen.queryByText(/matches the calldata/)).toBeNull();
  });

  it("unfolds a row into its arguments, and shows every call raw on request", () => {
    render(<CallList calls={[decodeCall({ target, value: "0", data })]} />);
    expect(screen.queryByText("spender")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call 1: approve" }));
    expect(screen.getByText("spender")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByText("approve(address,uint256)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
  });

  it("warns when bytes carry a known selector but do not decode to it exactly", () => {
    render(<CallList calls={[decodeCall({ target, value: "0", data: concat([data, "0x00"]) })]} />);
    expect(screen.getByText("Does not decode")).toBeInTheDocument();
    expect(screen.getByTestId("not-exact")).toHaveTextContent(
      "Starts with the selector of approve(address,uint256), but does not decode to it exactly"
    );
  });

  it("says plainly when no known ABI has the selector", () => {
    render(<CallList calls={[decodeCall({ target, value: "0", data: "0x22f3a9ba" })]} />);
    expect(screen.getByText("Unknown function")).toBeInTheDocument();
    expect(screen.getByText(/No known ABI has selector/)).toBeInTheDocument();
    expect(screen.queryByTestId("not-exact")).toBeNull();
  });
});
