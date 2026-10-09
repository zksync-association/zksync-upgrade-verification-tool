import {
  STATUS_MAX_AGE_MS,
  noteStatusLanded,
  requestStatusRevalidation,
  resetStatusRevalidation,
  shouldRevalidateRoot,
} from "@/utils/revalidation";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// root.tsx pulls in the server status, env and the wallet stack: stand-ins, to import its exports.
vi.mock("@/.server/status", () => ({ appStatus: vi.fn() }));
vi.mock("@config/env.server", () => ({ clientEnv: {} }));
vi.mock("@/components/app-shell", () => ({ default: () => null, StatusProblem: () => null }));
vi.mock("@/components/providers/wallet-provider", () => ({ WalletProvider: () => null }));
vi.mock("wagmi", () => ({ deserialize: vi.fn(), parseCookie: vi.fn() }));

// The arguments React Router passes a route's shouldRevalidate (router.js getMatchesToLoad), for
// each way this app can make it revalidate.
function args(
  current: string,
  next: string,
  defaultShouldRevalidate: boolean,
  submission?: { formMethod: string; formAction: string }
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(current, "http://localhost"),
    currentParams: {},
    nextUrl: new URL(next, "http://localhost"),
    nextParams: {},
    defaultShouldRevalidate,
    ...(submission as ShouldRevalidateFunctionArgs | undefined),
  } as ShouldRevalidateFunctionArgs;
}

const post = (formAction: string) => ({ formMethod: "POST", formAction });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetStatusRevalidation();
  noteStatusLanded({});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("root shouldRevalidate", () => {
  it.each([
    ["the history toggle", args("/app/proposals", "/app/proposals?history=all", true)],
    ["back to recent history", args("/app/emergency?history=all", "/app/emergency", true)],
    ["a ?sig= link", args("/app/proposals/0x01", "/app/proposals/0x01?sig=0x02:0x03", true)],
    [
      "freeze parameters",
      args("/app/freeze/soft-freeze", "/app/freeze/soft-freeze?nonce=1&validUntil=2", true),
    ],
    ["a click on the current page's link", args("/app/proposals", "/app/proposals", true)],
    ["a pathname navigation", args("/app/proposals", "/app/emergency", false)],
    [
      "the transaction page's polling revalidate()",
      args("/app/transactions/0x1", "/app/transactions/0x1", true),
    ],
    ["the home lookup action", args("/", "/", true, post("/?index"))],
    [
      "Simulate (an action of the page)",
      args("/app/emergency/0x1", "/app/emergency/0x1", true, post("/app/emergency/0x1")),
    ],
    ["a lookalike of settings", args("/", "/", true, post("/settings-backup"))],
    ["a path under refresh", args("/", "/", true, post("/resources/refresh/extra"))],
    ["a nested settings path", args("/", "/", true, post("/app/settings"))],
    [
      "a GET form to settings",
      args("/", "/settings", true, { formMethod: "GET", formAction: "/settings" }),
    ],
  ])("skips %s", (_name, input) => {
    expect(shouldRevalidateRoot(input)).toBe(false);
  });

  it.each([
    [
      "Refresh (fetcher POST)",
      args("/app/proposals", "/app/proposals", true, post("/resources/refresh")),
    ],
    ["a settings save", args("/settings", "/settings", true, post("/settings"))],
    [
      "a settings save with a query",
      args("/settings?x=1", "/settings?x=1", true, post("/settings?x=1")),
    ],
    [
      "a settings save with a trailing slash",
      args("/settings", "/settings", true, post("/settings/")),
    ],
    [
      "a lower-case method",
      args("/", "/", true, { formMethod: "post", formAction: "/resources/refresh" }),
    ],
  ])("re-reads the status after %s", (_name, input) => {
    expect(shouldRevalidateRoot(input)).toBe(true);
  });

  it("follows the router's default for those submissions (e.g. an action error it skips)", () => {
    expect(shouldRevalidateRoot(args("/settings", "/settings", false, post("/settings")))).toBe(
      false
    );
  });

  it("re-reads the status on request, until a status read after the request has landed", () => {
    const revalidate = args("/app/proposals/0x01", "/app/proposals/0x01", true);
    const toggle = args("/app/proposals", "/app/proposals?history=all", true);
    requestStatusRevalidation();
    expect(shouldRevalidateRoot(revalidate)).toBe(true);
    // That read was cut short (a navigation aborted it): the next one reads the status instead.
    expect(shouldRevalidateRoot(args("/app/proposals", "/app/emergency", false))).toBe(true);
    noteStatusLanded({});
    expect(shouldRevalidateRoot(revalidate)).toBe(false);
    expect(shouldRevalidateRoot(toggle)).toBe(false);
  });

  it("does not let a read decided before a request answer it", () => {
    const revalidate = args("/app/proposals/0x01", "/app/proposals/0x01", true);
    requestStatusRevalidation();
    expect(shouldRevalidateRoot(revalidate)).toBe(true);
    requestStatusRevalidation(); // while that read is out
    noteStatusLanded({});
    expect(shouldRevalidateRoot(revalidate)).toBe(true);
    noteStatusLanded({});
    expect(shouldRevalidateRoot(revalidate)).toBe(false);
  });

  it("re-reads a status older than 30 s on any navigation or revalidation, then keeps the new one", () => {
    const pathname = args("/app/proposals", "/app/emergency", false);
    const toggle = args("/app/proposals", "/app/proposals?history=all", true);
    vi.setSystemTime(Date.now() + STATUS_MAX_AGE_MS);
    expect(shouldRevalidateRoot(pathname)).toBe(false);
    vi.setSystemTime(Date.now() + 1);
    expect(shouldRevalidateRoot(pathname)).toBe(true);
    expect(shouldRevalidateRoot(toggle)).toBe(true);
    const landed = {};
    noteStatusLanded(landed);
    expect(shouldRevalidateRoot(toggle)).toBe(false);
    // The same status rendered again (a remount) is not a new one.
    vi.setSystemTime(Date.now() + STATUS_MAX_AGE_MS + 1);
    noteStatusLanded(landed);
    expect(shouldRevalidateRoot(toggle)).toBe(true);
  });

  it("re-reads when no status has landed yet (an error page, then Back)", () => {
    resetStatusRevalidation();
    expect(shouldRevalidateRoot(args("/app/proposals", "/app/emergency", false))).toBe(true);
  });

  it("is the root route's export", async () => {
    const root = await import("@/root");
    expect(root.shouldRevalidate).toBe(shouldRevalidateRoot);
  });
});
