import {
  GovernanceContext,
  type OkStatus,
  type RootStatus,
  StatusSourceContext,
  StatusUnavailable,
  WithStatus,
  useStatus,
  useStatusIfRead,
} from "@/components/governance-context";
import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import "@testing-library/jest-dom";

function StatusConsumer() {
  const status = useStatus();
  return <p>{status.governance.network.label}</p>;
}

function deferred() {
  let resolve!: (value: RootStatus) => void;
  const promise = new Promise<RootStatus>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const ok = { ok: true, governance: { network: { label: "Read network" } } } as OkStatus;

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

describe("a status still being read", () => {
  it("suspends a consumer until it is read: never a pending value", async () => {
    const status = deferred();
    render(
      <StatusSourceContext.Provider value={status.promise}>
        <Suspense fallback={<p>waiting</p>}>
          <StatusConsumer />
        </Suspense>
      </StatusSourceContext.Provider>
    );
    expect(screen.getByText("waiting")).toBeInTheDocument();
    await act(async () => status.resolve(ok));
    expect(screen.getByText("Read network")).toBeInTheDocument();
  });

  it("gives WithStatus its own fallback, then its children, or the problem when unreadable", async () => {
    const status = deferred();
    const view = render(
      <StatusSourceContext.Provider value={status.promise}>
        <WithStatus fallback="checking" problem={(p) => `problem: ${p.error}`}>
          {(s) => s.governance.network.label}
        </WithStatus>
      </StatusSourceContext.Provider>
    );
    expect(view.container).toHaveTextContent("checking");
    await act(async () => status.resolve(ok));
    expect(view.container).toHaveTextContent("Read network");

    const failed = deferred();
    view.rerender(
      <StatusSourceContext.Provider value={failed.promise}>
        <WithStatus fallback="checking" problem={(p) => `problem: ${p.error}`}>
          {(s) => s.governance.network.label}
        </WithStatus>
      </StatusSourceContext.Provider>
    );
    await act(async () => failed.resolve({ ok: false, error: "rpc down", hint: "" }));
    expect(view.container).toHaveTextContent("problem: rpc down");
  });

  it("throws StatusUnavailable from useStatus when it could not be read", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <StatusSourceContext.Provider value={{ ok: false, error: "rpc down", hint: "" }}>
            <StatusConsumer />
          </StatusSourceContext.Provider>
        )
      ).toThrow(StatusUnavailable);
    } finally {
      error.mockRestore();
    }
  });
});

describe("useStatusIfRead", () => {
  function Membership() {
    const status = useStatusIfRead();
    return <p>{status ? status.governance.network.label : "not read yet"}</p>;
  }

  it("never suspends: null until the status is read, then the status", async () => {
    const status = deferred();
    // No Suspense boundary: a suspension would fail the render.
    render(
      <StatusSourceContext.Provider value={status.promise}>
        <Membership />
      </StatusSourceContext.Provider>
    );
    expect(screen.getByText("not read yet")).toBeInTheDocument();
    await act(async () => status.resolve(ok));
    expect(screen.getByText("Read network")).toBeInTheDocument();
  });

  it("is null, never a throw, when the status could not be read", async () => {
    const status = deferred();
    render(
      <StatusSourceContext.Provider value={status.promise}>
        <Membership />
      </StatusSourceContext.Provider>
    );
    await act(async () => status.resolve({ ok: false, error: "rpc down", hint: "" }));
    expect(screen.getByText("not read yet")).toBeInTheDocument();
  });

  it("reads a status already in hand", () => {
    render(
      <GovernanceContext.Provider value={ok}>
        <Membership />
      </GovernanceContext.Provider>
    );
    expect(screen.getByText("Read network")).toBeInTheDocument();
  });
});
