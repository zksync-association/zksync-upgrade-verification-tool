import {
  DIRECT_LABEL,
  LAST_RUN_LABEL,
  LastRunCheck,
  LastRunNote,
  LastRunText,
} from "@/components/verification/last-run";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";

// A page answering from the last run's history is always labelled until this run's answer
// replaces it, with an alert (never silence) when re-reading fails or disagrees.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LastRunNote", () => {
  it("labels a list from the last run as re-verifying while this run's streams in", () => {
    render(<LastRunNote refresh="pending" what="The upgrades listed below" />);
    const note = screen.getByTestId("last-run");
    expect(note).toHaveTextContent(LAST_RUN_LABEL);
    expect(note).toHaveTextContent("History from last run · re-verifying");
    expect(note).toHaveTextContent("The upgrades listed below come from the history this app");
    expect(note).toHaveTextContent("replaces them when it arrives");
  });

  it("says so when reading the history again failed, keeping the label", () => {
    render(<LastRunNote refresh="failed" what="The executions listed below" />);
    const note = screen.getByTestId("last-run");
    expect(note).toHaveTextContent("History from last run");
    expect(note).not.toHaveTextContent("re-verifying");
    expect(note).toHaveTextContent("did not complete. Refresh the page to retry.");
  });
});

describe("LastRunCheck", () => {
  it("labels a start from the last run until this run confirms it, then shows nothing", async () => {
    const check = deferred<unknown>();
    render(<LastRunCheck check={check.promise} />);
    expect(screen.getByTestId("last-run-check")).toHaveTextContent(LAST_RUN_LABEL);
    await act(async () => check.resolve({ txHash: "0x01" }));
    expect(screen.queryByTestId("last-run-check")).toBeNull();
    expect(screen.queryByTestId("last-run-mismatch")).toBeNull();
  });

  it("alerts when this run's history does not confirm it", async () => {
    const check = deferred<unknown>();
    render(<LastRunCheck check={check.promise} />);
    await act(async () => check.reject(new Error("IndexIntegrityError")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not confirm this start from the last run"
    );
  });
});

describe("LastRunText", () => {
  const texts = {
    pending: "From the last run (re-verifying).",
    confirmed: "Decoded from the event.",
    failed: "Not confirmed by the chain.",
  };
  const text = (check: Promise<unknown> | null) =>
    render(
      <p data-testid="text">
        <LastRunText check={check} {...texts} />
      </p>
    );

  it("says re-verifying until this run confirms, then reads as any other", async () => {
    const check = deferred<unknown>();
    text(check.promise);
    expect(screen.getByTestId("text")).toHaveTextContent(texts.pending);
    await act(async () => check.resolve({ txHash: "0x01" }));
    expect(screen.getByTestId("text")).toHaveTextContent(texts.confirmed);
    expect(screen.getByTestId("text")).not.toHaveTextContent("re-verifying");
  });

  it("says so when this run's history does not confirm it", async () => {
    const check = deferred<unknown>();
    text(check.promise);
    await act(async () => check.reject(new Error("IndexIntegrityError")));
    expect(screen.getByTestId("text")).toHaveTextContent(texts.failed);
  });

  it("without a check (this run's history) is the confirmed text", () => {
    text(null);
    expect(screen.getByTestId("text")).toHaveTextContent(texts.confirmed);
  });
});

describe("an item located directly while the history index reads the history", () => {
  it("is labelled until the index confirms it, then shows nothing", async () => {
    const check = deferred<unknown>();
    render(<LastRunCheck check={check.promise} source="direct" what="execution" />);
    expect(screen.getByTestId("last-run-check")).toHaveTextContent(DIRECT_LABEL);
    expect(screen.getByTestId("last-run-check")).toHaveTextContent(
      "Located directly · history index verifying"
    );
    await act(async () => check.resolve({ txHash: "0x01" }));
    expect(screen.queryByTestId("last-run-check")).toBeNull();
  });

  it("raises an alert when the index does not confirm it", async () => {
    const check = deferred<unknown>();
    render(<LastRunCheck check={check.promise} source="direct" />);
    await act(async () => check.reject(new Error("integrity")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The handler's complete log history could not confirm this start, which was located directly."
    );
  });
});
