import type { AppStatus, ShellChain } from "@/.server/status";
import type { SerializeFrom } from "@remix-run/node";
import {
  Component,
  type ReactNode,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

// The root status is read while the page already streams. Whatever shows it waits for it on its own
// (useStatus suspends; WithStatus has its own fallback): a pending status never reaches a page as a
// value, and nothing is shown as checked before it is.

export type RootStatus = SerializeFrom<AppStatus>;
export type OkStatus = Extract<RootStatus, { ok: true }>;
export type StatusProblemValue = Extract<RootStatus, { ok: false }>;

export type StatusSource = Promise<RootStatus> | RootStatus;

export const StatusSourceContext = createContext<StatusSource | null>(null);

export const GovernanceContext = createContext<OkStatus | null>(null);

export type ChainView = SerializeFrom<ShellChain>;
export const ChainContext = createContext<ChainView | null>(null);

export function useChain(): ChainView | null {
  return useContext(ChainContext);
}

export class StatusUnavailable extends Error {
  override name = "StatusUnavailable";
  constructor(readonly problem: StatusProblemValue) {
    super(problem.error);
  }
}

type Tracked<T> = Promise<T> & { _tracked?: boolean; _data?: T; _error?: unknown };

// Freezes what reads a deferred value the router abandoned (as Remix's <Await> does).
const neverSettled = new Promise<never>(() => {});

// Records a deferred promise's outcome with the marks Remix's <Await> uses (`_tracked`, `_data`,
// `_error`), so both read one promise alike.
function track<T>(promise: Tracked<T>): Promise<unknown> {
  if (promise._tracked)
    return promise.then(
      () => {},
      () => {}
    );
  Object.defineProperty(promise, "_tracked", { get: () => true });
  return promise.then(
    (data) => Object.defineProperty(promise, "_data", { get: () => data }),
    (error: unknown) => Object.defineProperty(promise, "_error", { get: () => error })
  );
}

// A deferred promise's value, or a suspension until it settles: Remix's <Await> protocol.
function readDeferred<T>(source: Promise<T> | T): T {
  if (!(source instanceof Promise)) return source;
  const promise = source as Tracked<T>;
  if (promise._tracked) {
    if ("_error" in promise) {
      const error = promise._error;
      // The router dropped this load (a newer one replaced it): keep what is on screen.
      if (error instanceof Error && error.message === "Deferred data aborted") throw neverSettled;
      throw error;
    }
    if ("_data" in promise) return promise._data as T;
    throw promise;
  }
  throw track(promise);
}

function settledValue<T>(source: Promise<T> | T | null): T | null {
  if (source === null || !(source instanceof Promise)) return source;
  const promise = source as Tracked<T>;
  return promise._tracked && "_data" in promise ? (promise._data as T) : null;
}

function useRootStatus(): RootStatus {
  const given = useContext(GovernanceContext);
  const source = useContext(StatusSourceContext);
  if (given) return given;
  if (source === null) throw new Error("App status unavailable");
  return readDeferred(source);
}

// Suspends until read; throws StatusUnavailable when it could not be (the app shell then shows
// why). Never a pending or unverified value.
export function useStatus(): OkStatus {
  const status = useRootStatus();
  if (!status.ok) throw new StatusUnavailable(status);
  return status;
}

// Never suspends: a part that only refines what it shows with the status (who the connected account
// is a member Safe of) renders at once, and again when it is in.
export function useStatusIfRead(): OkStatus | null {
  const given = useContext(GovernanceContext);
  const source = useContext(StatusSourceContext);
  const [, settled] = useState(0);
  const status = given ?? settledValue(source);
  useEffect(() => {
    if (status !== null || !(source instanceof Promise)) return;
    let live = true;
    void track(source as Tracked<RootStatus>).then(() => {
      if (live) settled((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [source, status]);
  return status?.ok ? status : null;
}

function StatusRead({
  children,
  problem,
}: {
  children: (status: OkStatus) => ReactNode;
  problem?: (status: StatusProblemValue) => ReactNode;
}) {
  const status = useRootStatus();
  if (!status.ok) return <>{problem?.(status) ?? null}</>;
  return <GovernanceContext.Provider value={status}>{children(status)}</GovernanceContext.Provider>;
}

export function WithStatus({
  fallback,
  problem,
  children,
}: {
  fallback: ReactNode;
  problem?: (status: StatusProblemValue) => ReactNode;
  children: (status: OkStatus) => ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <StatusRead problem={problem}>{children}</StatusRead>
    </Suspense>
  );
}

type BoundaryProps = {
  source: StatusSource | null;
  problem: (status: StatusProblemValue) => ReactNode;
  children: ReactNode;
};
type BoundaryState = {
  problem: StatusUnavailable | null;
  other: { error: unknown } | null;
  source: StatusSource | null;
};

// `problem` in place of children that needed the status when it could not be read; other errors go
// on to the route's error boundary. A new status source (Refresh, a settings save) tries again.
export class StatusBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { problem: null, other: null, source: this.props.source };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return error instanceof StatusUnavailable
      ? { problem: error, other: null }
      : { problem: null, other: { error } };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState
  ): Partial<BoundaryState> | null {
    return props.source === state.source
      ? null
      : { problem: null, other: null, source: props.source };
  }

  override render() {
    if (this.state.other) throw this.state.other.error;
    if (this.state.problem) return this.props.problem(this.state.problem.problem);
    return this.props.children;
  }
}
