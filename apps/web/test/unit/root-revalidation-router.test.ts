import { createRequire } from "node:module";
import {
  STATUS_MAX_AGE_MS,
  noteStatusLanded,
  requestStatusRevalidation,
  resetStatusRevalidation,
  shouldRevalidateRoot,
} from "@/utils/revalidation";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The root's shouldRevalidate under the router Remix runs in the browser (@remix-run/router, the
// version @remix-run/react depends on), on a route tree shaped like the app's: which formAction
// and defaultShouldRevalidate it really passes, and what a navigation does to a reload in flight.

type Args = { request: Request };
type Route = {
  id: string;
  path?: string;
  index?: boolean;
  loader?: (args: Args) => unknown;
  action?: (args: Args) => unknown;
  shouldRevalidate?: (args: ShouldRevalidateFunctionArgs) => boolean;
  children?: Route[];
};
type Submission = { formMethod: "post"; formData: FormData };
type RouterState = {
  initialized: boolean;
  navigation: { state: string };
  revalidation: string;
  fetchers: Map<string, { state: string }>;
  loaderData: Record<string, unknown>;
};
type Router = {
  state: RouterState;
  initialize(): Router;
  navigate(to: string, opts?: Submission): Promise<void>;
  fetch(key: string, routeId: string, href: string, opts?: Submission): void;
  revalidate(): void;
  subscribe(fn: (state: RouterState) => void): () => void;
  dispose(): void;
};
type RouterModule = {
  createRouter(init: {
    routes: Route[];
    history: unknown;
    future: Record<string, boolean>;
  }): Router;
  createMemoryHistory(options: { initialEntries: string[] }): unknown;
};

const fromRemix = createRequire(createRequire(import.meta.url).resolve("@remix-run/react"));
const { createRouter, createMemoryHistory } = fromRemix("@remix-run/router") as RouterModule;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (): Submission => ({ formMethod: "post", formData: new FormData() });

let router: Router | undefined;

function app(initial: string, { rootMs = 0, settingsStatus = 200 } = {}) {
  router?.dispose();
  const loads: Record<string, number> = {};
  const load =
    (id: string, ms = 0) =>
    async () => {
      loads[id] = (loads[id] ?? 0) + 1;
      const read = loads[id];
      if (ms) await sleep(ms);
      return { read };
    };
  const leaf = (id: string, path: string, extra: Partial<Route> = {}): Route => ({
    id,
    path,
    loader: load(id),
    ...extra,
  });
  router = createRouter({
    history: createMemoryHistory({ initialEntries: [initial] }),
    // As @remix-run/react's RemixBrowser creates it (no single fetch).
    future: {
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_prependBasename: true,
      v7_skipActionErrorRevalidation: false,
    },
    routes: [
      {
        id: "root",
        path: "/",
        loader: load("root", rootMs),
        shouldRevalidate: shouldRevalidateRoot,
        children: [
          { id: "home", index: true, loader: load("home"), action: () => ({ found: false }) },
          leaf("proposals", "app/proposals"),
          leaf("emergency", "app/emergency"),
          leaf("freeze", "app/freeze"),
          leaf("tx", "app/transactions/:hash"),
          leaf("proposal", "app/proposals/:id", { action: () => ({ simulated: true }) }),
          leaf("settings", "settings", {
            action: () =>
              new Response(JSON.stringify({ saved: settingsStatus === 200 }), {
                status: settingsStatus,
                headers: { "content-type": "application/json" },
              }),
          }),
          { id: "refresh", path: "resources/refresh", action: () => ({ refreshed: true }) },
        ],
      },
    ],
  });
  // The app shell's effect: each root status that lands answers the requests made before its read.
  router.subscribe((state) => {
    const root = state.loaderData.root;
    if (root) noteStatusLanded(root);
  });
  router.initialize();
  const r = router;
  return {
    router: r,
    loads,
    rootRead: () => (r.state.loaderData.root as { read: number } | undefined)?.read,
    async settle() {
      for (let i = 0; i < 400; i++) {
        await sleep(2);
        const busy = [...r.state.fetchers.values()].some((f) => f.state !== "idle");
        if (
          r.state.initialized &&
          r.state.navigation.state === "idle" &&
          r.state.revalidation === "idle" &&
          !busy
        )
          return;
      }
      throw new Error("the router did not settle");
    },
  };
}

beforeEach(() => resetStatusRevalidation());
afterEach(() => {
  router?.dispose();
  router = undefined;
  vi.useRealTimers();
});

describe("the root status, with the real router", () => {
  it("is kept on the history toggle, a ?sig= link, the transaction page's polling and Simulate", async () => {
    const a = app("/app/proposals");
    await a.settle();
    expect(a.loads).toEqual({ root: 1, proposals: 1 });
    await a.router.navigate("/app/proposals?history=all");
    await a.settle();
    await a.router.navigate("/app/proposals/0x01?sig=0x02:0x03");
    await a.settle();
    a.router.fetch("simulate", "proposal", "/app/proposals/0x01", post());
    await a.settle();
    await a.router.navigate("/app/transactions/0x1");
    await a.settle();
    a.router.revalidate();
    await a.settle();
    a.router.revalidate();
    await a.settle();
    expect(a.loads.root).toBe(1);
    expect(a.loads.tx).toBe(3);
  });

  it("is read once after Refresh, and once after a settings save (also a rejected one)", async () => {
    const a = app("/app/proposals");
    await a.settle();
    requestStatusRevalidation(); // the Refresh click
    a.router.fetch("refresh", "proposals", "/resources/refresh", post());
    await a.settle();
    expect(a.loads).toEqual({ root: 2, proposals: 2 });
    await a.router.navigate("/app/proposals?history=all");
    await a.settle();
    expect(a.loads.root).toBe(2);

    for (const settingsStatus of [200, 400]) {
      const s = app("/settings", { settingsStatus });
      await s.settle();
      await s.router.navigate("/settings", post());
      await s.settle();
      expect(s.loads.root).toBe(2);
    }
  });

  it("is read once on a requested revalidation (signing, a mined transaction, the index finishing)", async () => {
    const a = app("/app/transactions/0x1");
    await a.settle();
    requestStatusRevalidation();
    a.router.revalidate();
    await a.settle();
    expect(a.loads).toEqual({ root: 2, tx: 2 });
    a.router.revalidate();
    await a.settle();
    expect(a.loads).toEqual({ root: 2, tx: 3 });
  });

  it("is still read when a navigation cuts Refresh's reload short", async () => {
    const a = app("/app/proposals", { rootMs: 40 });
    await a.settle();
    expect(a.rootRead()).toBe(1);
    requestStatusRevalidation();
    a.router.fetch("refresh", "proposals", "/resources/refresh", post());
    await sleep(15); // the action is done; the reload is reading the status
    expect(a.loads.root).toBe(2);
    await a.router.navigate("/app/emergency");
    await a.settle();
    // The navigation dropped the reload's status and read its own (before: still read #1).
    expect(a.rootRead()).toBe(3);
    await a.router.navigate("/app/freeze");
    await a.settle();
    expect(a.loads.root).toBe(3);
  });

  it("holds a request made while a read is in flight until a read after it lands", async () => {
    const a = app("/app/proposals", { rootMs: 30 });
    await a.settle();
    requestStatusRevalidation();
    a.router.revalidate();
    await sleep(10); // read #2 is out
    requestStatusRevalidation(); // e.g. a signature just landed
    await a.settle();
    expect(a.rootRead()).toBe(2);
    await a.router.navigate("/app/proposals?history=all");
    await a.settle();
    expect(a.rootRead()).toBe(3);
    await a.router.navigate("/app/emergency");
    await a.settle();
    expect(a.loads.root).toBe(3);
  });

  it("is read on the next navigation of any kind once it is older than 30 s, then kept again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = app("/app/proposals");
    await a.settle();
    await a.router.navigate("/app/emergency");
    await a.settle();
    expect(a.loads.root).toBe(1);
    vi.setSystemTime(Date.now() + STATUS_MAX_AGE_MS + 1);
    await a.router.navigate("/app/freeze");
    await a.settle();
    expect(a.loads.root).toBe(2);
    await a.router.navigate("/app/freeze?x=1");
    await a.settle();
    expect(a.loads.root).toBe(2);
  });
});
