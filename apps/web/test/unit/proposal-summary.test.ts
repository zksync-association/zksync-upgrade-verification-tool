import { proposalSummary } from "@/common/proposal-title";
import { describe, expect, it } from "vitest";

// What an upgrade changes, under its title: the proposal's own summary, in plain text.

const ZIP = `# [ZIP-17] Enable Chain-Specific Execution-Delay Increases for EraVM ZK Chains

## Proposal Type

ZIP

## Short Summary

This proposal lets each **EraVM ZK chain** raise its own [execution delay](https://docs.zksync.io)
without a protocol-wide upgrade, by upgrading the \`ValidatorTimelock\`.

## Motivation

- First point
- Second point
`;

describe("an upgrade's summary", () => {
  it("is the paragraph under the proposal's summary heading, markdown removed", () => {
    expect(proposalSummary(ZIP)).toBe(
      "This proposal lets each EraVM ZK chain raise its own execution delay without a protocol-wide upgrade, by upgrading the ValidatorTimelock."
    );
  });

  it("else the first paragraph long enough to say something, never a list, table or code", () => {
    const text = [
      "# Title",
      "ZIP",
      "- a list item that is long enough to count as prose otherwise",
      "| a | b |",
      "```\ncode block that is long enough to count as a paragraph here\n```",
      "The upgrade moves the bridge to the new shared router and retires the old one.",
    ].join("\n\n");
    expect(proposalSummary(text)).toBe(
      "The upgrade moves the bridge to the new shared router and retires the old one."
    );
  });

  it("keeps whole sentences when it must be shortened", () => {
    const first = `This proposal deploys an updated contract that lets each chain raise its own delay${" a bit".repeat(10)}.`;
    const text = `# T\n\n## Short Summary\n\n${first} ${"More words follow here. ".repeat(12)}`;
    expect(proposalSummary(text)?.startsWith(first)).toBe(true);
    expect(proposalSummary(text)?.endsWith(".")).toBe(true);
    expect((proposalSummary(text) ?? "").length).toBeLessThanOrEqual(280);
  });

  it("is cut at a word under 280 characters, and null when there is nothing to say", () => {
    const long = `# T\n\n## Summary\n\n${"word ".repeat(100)}`;
    const summary = proposalSummary(long) ?? "";
    expect(summary.length).toBeLessThanOrEqual(280);
    expect(summary.endsWith("word…")).toBe(true);
    expect(proposalSummary("# Only a title")).toBeNull();
    expect(proposalSummary("")).toBeNull();
  });
});
