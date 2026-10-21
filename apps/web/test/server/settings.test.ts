import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  env: {
    SERVER_HOST: "127.0.0.1",
    L1_RPC_URL: "https://l1.example/secret",
    L2_RPC_URL: undefined as string | undefined,
    SAFE_API_KEY: "secret-key",
  },
  chain: 1,
  l2Chain: 324,
  fail: false,
  save: vi.fn(),
  resetRpc: vi.fn(),
  resetSafe: vi.fn(),
  resetLogs: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@config/env.server", () => ({ env: state.env }));
vi.mock("@config/local-settings.server", () => ({ saveLocalSettings: state.save }));
vi.mock("@/.server/cache", () => ({ clearCache: state.clear }));
vi.mock("@/.server/rpc", () => ({ resetRpcClients: state.resetRpc }));
vi.mock("@/.server/logs", () => ({ resetLogCaches: state.resetLogs }));
vi.mock("@/.server/safe-api", () => ({ resetSafeClient: state.resetSafe }));
vi.mock("viem", () => ({
  http: (url: string) => url,
  createPublicClient: ({ transport }: { transport: string }) => ({
    getChainId: async () => {
      if (state.fail) throw new Error(`Secret URL ${transport}`);
      return transport.includes("l2") ? state.l2Chain : state.chain;
    },
  }),
}));
const { requireLocalSettings, settingsSummary, updateSettings } = await import(
  "@/.server/settings"
);
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  state.env.SERVER_HOST = "127.0.0.1";
  state.env.L2_RPC_URL = undefined;
  state.chain = 1;
  state.l2Chain = 324;
  state.fail = false;
});

it("allows settings only on a loopback-bound server and same-origin submissions", () => {
  expect(() => requireLocalSettings(new Request("http://localhost:3000/settings"))).not.toThrow();
  expect(() =>
    requireLocalSettings(
      new Request("http://localhost:3000/settings", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      })
    )
  ).not.toThrow();
  expect(() =>
    requireLocalSettings(
      new Request("http://localhost:3000/settings", {
        method: "POST",
        headers: { Origin: "https://other.example" },
      })
    )
  ).toThrow();
  expect(() => requireLocalSettings(new Request("http://other.example/settings"))).toThrow();
  state.env.SERVER_HOST = "0.0.0.0";
  expect(() => requireLocalSettings(new Request("http://localhost:3000/settings"))).toThrow();
});

it("returns the saved values for the settings page, the file build's placeholder as none", () => {
  expect(settingsSummary()).toEqual({
    l1Rpc: "https://l1.example/secret",
    l2Rpc: null,
    safeKey: "secret-key",
    wcProjectId: null,
  });
  state.env.L1_RPC_URL = "https://rpc.not-configured.invalid";
  expect(settingsSummary().l1Rpc).toBeNull();
  state.env.L1_RPC_URL = "https://l1.example/secret";
});

it("saves, rejects and removes a WalletConnect project id", async () => {
  await updateSettings(form({ wcProjectId: "0123456789abcdef0123456789abcdef" }));
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ WALLET_CONNECT_PROJECT_ID: "0123456789abcdef0123456789abcdef" })
  );
  await expect(updateSettings(form({ wcProjectId: "not an id!" }))).rejects.toThrow(
    "Enter a WalletConnect project id"
  );
  await updateSettings(form({ clearWcProjectId: "on" }));
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ WALLET_CONNECT_PROJECT_ID: null })
  );
});

it("persists replacements and resets every data client/cache", async () => {
  await updateSettings(
    form({ l1Rpc: "https://l1.example/new", l2Rpc: "https://l2.example/new", safeKey: "new-key" })
  );
  expect(state.save).toHaveBeenCalledWith({
    L1_RPC_URL: "https://l1.example/new",
    L2_RPC_URL: "https://l2.example/new",
    SAFE_API_KEY: "new-key",
  });
  for (const reset of [state.clear, state.resetLogs, state.resetRpc, state.resetSafe])
    expect(reset).toHaveBeenCalledOnce();
});

it("keeps blank fields and supports explicit key/default-provider removal", async () => {
  await updateSettings(form({ safeKey: "", l1Rpc: "", l2Rpc: "" }));
  expect(state.save).toHaveBeenLastCalledWith({});
  await updateSettings(form({ clearSafeKey: "on", clearL2Rpc: "on" }));
  expect(state.save).toHaveBeenLastCalledWith({ SAFE_API_KEY: null, L2_RPC_URL: null });
});

it("rejects unsupported or mismatched chains before persistence", async () => {
  state.chain = 10;
  await expect(updateSettings(form({ l1Rpc: "https://l1.example" }))).rejects.toThrow(
    "Ethereum Mainnet or Sepolia"
  );
  state.chain = 11155111;
  await expect(updateSettings(form({ l2Rpc: "https://l2.example" }))).rejects.toThrow(
    "ZKsync Sepolia"
  );
  expect(state.save).not.toHaveBeenCalled();
  expect(state.clear).not.toHaveBeenCalled();
});

it("redacts provider errors and rejects non-HTTP RPCs", async () => {
  state.fail = true;
  await expect(updateSettings(form({ l1Rpc: "https://l1.example/private-token" }))).rejects.toThrow(
    "Could not connect"
  );
  await expect(updateSettings(form({ l1Rpc: "file:///tmp/rpc" }))).rejects.toThrow(
    "RPC URLs must start"
  );
  expect(state.save).not.toHaveBeenCalled();
});
