import { vi } from "vitest";

// A test that times out keeps running (vitest cannot stop it), and its next fake-time steps move
// the next test's clock. Importing this module routes vi.advanceTimersByTimeAsync through a guard:
// a step that ends after its test ended (endTestSteps, first in afterEach) never returns, so the
// body stops there without an error; endTestSteps waits for the steps in flight.

type Step = (ms: number) => Promise<unknown>;
type Guard = { turn: number; inFlight: Set<Promise<unknown>>; parked: number };

// Taken at import, before any test fakes the timers: the bound on the wait is real time.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

// One guard per vi, kept on it: every copy of this module that sees this vi shares it.
const KEY = Symbol.for("test-end.guard");
const holder = vi as typeof vi & { [KEY]?: Guard };
holder[KEY] ??= install();
const guard: Guard = holder[KEY];

function install(): Guard {
  const state: Guard = { turn: 0, inFlight: new Set(), parked: 0 };
  const original: Step = vi.advanceTimersByTimeAsync.bind(vi);
  const guarded = async (ms: number) => {
    const startedIn = state.turn;
    const step = original(ms);
    state.inFlight.add(step);
    try {
      await step;
    } finally {
      state.inFlight.delete(step);
    }
    if (state.turn !== startedIn) {
      state.parked++;
      return new Promise<never>(() => {});
    }
    return vi;
  };
  vi.advanceTimersByTimeAsync = guarded as typeof vi.advanceTimersByTimeAsync;
  return state;
}

/**
 * For the first line of a file's afterEach: ends this test's fake-time steps, and waits up to
 * `maxMs` of real time for one in flight (a timed-out body stops at its end).
 */
export async function endTestSteps(maxMs = 20_000): Promise<void> {
  guard.turn++;
  if (guard.inFlight.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...guard.inFlight]),
    new Promise<void>((resolve) => {
      timer = realSetTimeout(resolve, maxMs);
    }),
  ]);
  realClearTimeout(timer);
  await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

/** How many steps of ended tests were stopped so far (for the guard's own test). */
export function parkedSteps(): number {
  return guard.parked;
}
