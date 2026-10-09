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

// The root status (network, governance roles, thresholds, freeze state, log history, sync) is read
// on the server while the page is already streaming: the app shell and every page render before
// it is in. Whatever shows it waits for it on its own (useStatus suspends; WithStatus has its own
// fallback), so a pending status never reaches a page as a value, and nothing is shown as checked
// before it is.

export type RootStatus = SerializeFrom<AppStatus>;
export type OkStatus = Extract<RootStatus, { ok: true }>;
export type StatusProblemValue = Extract<RootStatus, { ok: false }>;

/** The root loader's status: a promise until the server has read it (or the status itself). */
export type StatusSource = Promise<RootStatus> | RootStatus;

export const StatusSourceContext = createContext<StatusSource | null>(null);

/** A verified status in hand (inside WithStatus, or given directly, e.g. in tests). */
export const GovernanceContext = createContext<OkStatus | null>(null);

/** The chain the app shell was set up for (from the RPC's chain id, before anything else). */
export type ChainView = SerializeFrom<ShellChain>;
export const ChainContext = createContext<ChainView | null>(null);

/** The chain the RPC is on, once the app shell knows it (null outside it). */
export function useChain(): ChainView | null {
  return useContext(ChainContext);
}

/** The status could not be read (the RPC failed, or no pinned handler for its chain). */
export class StatusUnavailable extends Error {
  override name = "StatusUnavailable";
  constructor(readonly problem: StatusProblemValue) {
    super(problem.error);
  }
}

type Tracked<T> = Promise<T> & { _tracked?: boolean; _data?: T; _error?: unknown };

// Freezes what reads a deferred value the router abandoned (as Remix's <Await> does).
const neverSettled = new Promise<never>(() => {});

/**
 * Marks a deferred loader promise as tracked, recording its outcome as Remix's <Await> does (the
 * same `_tracked`/`_data`/`_error` marks, so both read one promise alike). Returns what settles
 * once the outcome is recorded.
 */
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

/**
 * The value of a deferred loader promise, or a suspension until it settles: the protocol of
 * Remix's <Await>.
 */
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

/** The value of a deferred loader promise once it has one, else null (pending or failed). */
function settledValue<T>(source: Promise<T> | T | null): T | null {
  if (source === null || !(source instanceof Promise)) return source;
  const promise = source as Tracked<T>;
  return promise._tracked && "_data" in promise ? (promise._data as T) : null;
}

/** The root status as read: suspends until it is (to the nearest <Suspense>). */
function useRootStatus(): RootStatus {
  const given = useContext(GovernanceContext);
  const source = useContext(StatusSourceContext);
  if (given) return given;
  if (source === null) throw new Error("App status unavailable");
  return readDeferred(source);
}

/**
 * The verified root status. Suspends until it is read; throws StatusUnavailable when it could not
 * be (the app shell then shows why). Never a pending or unverified value.
 */
export function useStatus(): OkStatus {
  const status = useRootStatus();
  if (!status.ok) throw new StatusUnavailable(status);
  return status;
}

/**
 * The verified root status once it is read, else null: never suspends, so a part that only
 * refines what it shows with it (who the connected account is a member Safe of) renders at once,
 * and again when the status is in. null too when the status could not be read.
 */
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

/**
 * `children(status)` once the root status is read, `fallback` until then (its own Suspense
 * boundary), and `problem(status)` (default: nothing) when it could not be read.
 */
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

/**
 * Shows `problem` in place of its children when one of them needed the status and it could not
 * be read (StatusUnavailable); any other error goes on to the route's error boundary. A new
 * status source (Refresh, a settings save) tries the children again.
 */
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
