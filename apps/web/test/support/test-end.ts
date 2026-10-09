import { vi } from "vitest";

// A test that times out keeps running. vitest goes on to the next test, but JavaScript cannot stop
// the timed-out body, and that body is almost always inside a fake-time step then (a loop of
// blocks). The step finishes and the body goes on: its next steps move the next test's fake clock,
// and its beats reach the next test's presence registry. Stopping the engine and resetting presence
// in afterEach cannot prevent this: the body has to stop. (D5: the watcher test ran past its 5 s
// under load and failed the next test with "expected 12 to be 3".)
//
// Importing this module routes vi.advanceTimersByTimeAsync through a guard. A step that ends after
// its test ended (endTestSteps, called first in the file's afterEach) never returns: the body waits
// at that step for good, so nothing after it runs. No error is thrown, so a step nobody awaits
// cannot cause an unhandled rejection. endTestSteps waits for the steps in flight, so the body has
// stopped before afterEach resets anything.

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
 * For the first line of a file's afterEach: ends this test's fake-time steps. A body still running
 * (the test timed out) stops at the end of the step it is in. This waits for that step, up to
 * `maxMs` of real time, plus one real turn of the event loop for the body to reach it.
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
