import { beforeEach, expect, it, vi } from "vitest";

// The settings page warms the new data sources once a change is saved, in the background.

const state = vi.hoisted(() => ({
  fail: false,
  order: [] as string[],
}));

vi.mock("@/.server/settings", () => ({
  requireLocalSettings: () => {},
  settingsSummary: () => ({}),
  updateSettings: vi.fn(async () => {
    state.order.push("update");
    if (state.fail) throw new Error("Could not connect to the RPC.");
  }),
}));
vi.mock("@/.server/prewarm", () => ({
  prewarm: vi.fn((reason: string) => {
    state.order.push(`prewarm:${reason}`);
    // Never awaited by the action: a slow warm-up must not hold the response.
    return new Promise(() => {});
  }),
}));

vi.mock("@/.server/sync/engine", () => ({
  startSync: vi.fn(() => {
    state.order.push("sync");
  }),
}));

const { action } = await import("@/routes/settings/_route");
const { prewarm } = await import("@/.server/prewarm");
const { startSync } = await import("@/.server/sync/engine");

const save = () =>
  action({
    request: new Request("http://localhost:3000/settings", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
      body: new URLSearchParams({ l1Rpc: "https://rpc.example" }),
    }),
    params: {},
    context: {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.fail = false;
  state.order = [];
});

it("prewarms and restarts the sync engine after a successful settings change, without waiting", async () => {
  const response = await save();
  expect(response.status).toBe(200);
  expect(state.order).toEqual(["update", "prewarm:settings", "sync"]);
});

it("does not prewarm or restart the engine when the settings were not saved", async () => {
  state.fail = true;
  const response = await save();
  expect(response.status).toBe(400);
  expect(prewarm).not.toHaveBeenCalled();
  expect(startSync).not.toHaveBeenCalled();
});
