import {
  UncheckedPayloadNote,
  UncheckedPayloadWarning,
} from "@/components/verification/unchecked-payload";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

// Members of an emergency upgrade sign only its id: until the viewer has checked a payload against
// it, the page warns (whether or not anyone signed yet), and the review before signing says so too.

const role = (valid: number, status = valid ? "valid" : "missing") => ({
  set: { valid: Array.from({ length: valid }, () => ({})), members: [{ status }] },
});
const signed = [role(6), role(2), role(0)];
const unsigned = [role(0), role(0), role(0)];

describe("an emergency upgrade's unchecked payload", () => {
  it("signed, no payload loaded: its calls are not checked, and the button goes to the payload", () => {
    const onLoad = vi.fn();
    render(<UncheckedPayloadWarning roles={signed} check={null} onLoad={onLoad} />);
    const warning = screen.getByTestId("unchecked-payload");
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning).toHaveTextContent("Check the payload before you sign or execute");
    expect(warning).toHaveTextContent(
      "Members have already signed this emergency upgrade, but a signature covers only its id, not the calls it runs"
    );
    fireEvent.click(screen.getByRole("button", { name: "Load the payload" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("before anyone signed (the first signer, a Guardian say): warned too, without saying others signed", () => {
    render(<UncheckedPayloadWarning roles={unsigned} check={null} onLoad={() => {}} />);
    const warning = screen.getByTestId("unchecked-payload");
    expect(warning).toHaveTextContent("Check the payload before you sign or execute");
    expect(warning).toHaveTextContent("A signature covers only its id, not the calls it runs");
    expect(warning).not.toHaveTextContent("already signed");
  });

  it("a Safe still collecting its owners' signatures counts as signed", () => {
    render(
      <UncheckedPayloadWarning roles={[role(0, "collecting")]} check={null} onLoad={() => {}} />
    );
    expect(screen.getByTestId("unchecked-payload")).toHaveTextContent("already signed");
  });

  it("a payload that does not match: not to be signed or executed from", () => {
    render(<UncheckedPayloadWarning roles={signed} check={{ ok: false }} onLoad={() => {}} />);
    const warning = screen.getByTestId("unchecked-payload");
    expect(warning).toHaveAttribute("data-kind", "mismatch");
    expect(warning).toHaveTextContent("The payload you loaded does not match this id");
    expect(warning).toHaveTextContent("Do not sign or execute this upgrade from it");
    expect(screen.getByRole("button", { name: "Load another payload" })).toBeInTheDocument();
  });

  it("nothing once the payload matches", () => {
    render(<UncheckedPayloadWarning roles={signed} check={{ ok: true }} onLoad={() => {}} />);
    expect(screen.queryByTestId("unchecked-payload")).toBeNull();
  });

  it("the review before signing says it too, and nothing once the payload matches", () => {
    const { rerender } = render(<UncheckedPayloadNote check={null} />);
    expect(screen.getByTestId("unchecked-payload-note")).toHaveTextContent(
      "You have not checked this upgrade's payload"
    );
    rerender(<UncheckedPayloadNote check={{ ok: false }} />);
    expect(screen.getByTestId("unchecked-payload-note")).toHaveTextContent(
      "The payload you loaded does not match this id"
    );
    rerender(<UncheckedPayloadNote check={{ ok: true }} />);
    expect(screen.queryByTestId("unchecked-payload-note")).toBeNull();
  });
});
