import { proposalTitle } from "@/common/proposal-title";
import { describe, expect, it } from "vitest";

describe("proposalTitle", () => {
  it("is the description's first line, without its heading marks", () => {
    expect(
      proposalTitle(
        "# [ZIP-17] Enable Chain-Specific Execution-Delay Increases\n| Field | Details |"
      )
    ).toBe("[ZIP-17] Enable Chain-Specific Execution-Delay Increases");
    expect(proposalTitle("\n\n  ## Title after blank lines  \nbody")).toBe(
      "Title after blank lines"
    );
  });

  it("drops characters that could make it read differently", () => {
    // A right-to-left override and a zero-width space.
    expect(proposalTitle("# Safe‮gnirts​ title")).toBe("Safegnirts title");
  });

  it("bounds its length, and is null without a first line", () => {
    expect(proposalTitle(`# ${"a".repeat(300)}`)?.length).toBe(160);
    expect(proposalTitle("")).toBeNull();
    expect(proposalTitle("#\n \n")).toBeNull();
  });
});
