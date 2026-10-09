import { UntilFresh } from "@/components/verification/until-fresh";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";

const view = (first: string) => (fresh: string | null, refresh: string | null) => (
  <p data-testid="shown">
    {fresh ?? first} · {refresh ?? "settled"}
  </p>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("UntilFresh", () => {
  it("shows a stale first answer as pending until the fresh result replaces it", async () => {
    const fresh = deferred<string | null>();
    render(
      <UntilFresh stale fresh={fresh.promise}>
        {view("first")}
      </UntilFresh>
    );
    expect(screen.getByTestId("shown")).toHaveTextContent("first · pending");
    await act(async () => fresh.resolve("fresh"));
    expect(await screen.findByText("fresh · settled")).toBeInTheDocument();
  });

  it("keeps the stale first answer, saying so, when the fresh result fails", async () => {
    const fresh = deferred<string | null>();
    render(
      <UntilFresh stale fresh={fresh.promise}>
        {view("first")}
      </UntilFresh>
    );
    await act(async () => fresh.reject(new Error("RPC down")));
    expect(await screen.findByText("first · failed")).toBeInTheDocument();
  });

  it("shows a first answer that already is fresh as it is, without waiting", () => {
    const never = new Promise<string | null>(() => {});
    render(
      <UntilFresh stale={false} fresh={never}>
        {view("first")}
      </UntilFresh>
    );
    expect(screen.getByTestId("shown")).toHaveTextContent("first · settled");
  });
});
