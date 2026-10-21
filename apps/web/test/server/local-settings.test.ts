import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Which saved settings a process honours. Test suites name their own RPC; the fork and mainnet
// suites ignore only the saved RPC settings (LOCAL_SETTINGS_IGNORE), so a saved SAFE_API_KEY still
// applies; the hermetic suites ignore everything (IGNORE_LOCAL_SETTINGS). The file system is an
// in-memory fake: nothing here reads or writes a real settings file.

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  reads: [] as string[],
  writes: [] as string[],
}));

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    fs.reads.push(path);
    const text = fs.files.get(path);
    if (text === undefined) throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    return text;
  },
  writeFileSync: (path: string, text: string) => {
    fs.writes.push(path);
    fs.files.set(path, text);
  },
  renameSync: (from: string, to: string) => {
    fs.files.set(to, fs.files.get(from) as string);
    fs.files.delete(from);
  },
  mkdirSync: () => undefined,
}));

const PATH = resolve(".cache/local-settings.json");
const SAVED = {
  L1_RPC_URL: "https://saved-l1.example.invalid/v3/key",
  L2_RPC_URL: "https://saved-l2.example.invalid/",
  SAFE_API_KEY: "saved-safe-key",
};

async function load(environment: {
  IGNORE_LOCAL_SETTINGS?: string;
  LOCAL_SETTINGS_IGNORE?: string;
}) {
  vi.resetModules();
  vi.stubEnv("IGNORE_LOCAL_SETTINGS", environment.IGNORE_LOCAL_SETTINGS ?? "");
  vi.stubEnv("LOCAL_SETTINGS_IGNORE", environment.LOCAL_SETTINGS_IGNORE ?? "");
  return import("@config/local-settings.server");
}

beforeEach(() => {
  fs.files.clear();
  fs.files.set(PATH, JSON.stringify(SAVED));
  fs.reads = [];
  fs.writes = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("LOCAL_SETTINGS_IGNORE (the fork and mainnet suites)", () => {
  it("drops only the listed settings: the saved SAFE_API_KEY still applies", async () => {
    const settings = await load({ LOCAL_SETTINGS_IGNORE: "L1_RPC_URL,L2_RPC_URL" });
    expect(settings.localSetting("L1_RPC_URL")).toBeUndefined();
    expect(settings.localSetting("L2_RPC_URL")).toBeUndefined();
    expect(settings.localSetting("SAFE_API_KEY")).toBe("saved-safe-key");
  });

  it("feeds env: the suite's RPC from the environment, the saved Safe key from the file", async () => {
    await load({ LOCAL_SETTINGS_IGNORE: "L1_RPC_URL, L2_RPC_URL" });
    const { env } = await import("@config/env.server");
    expect(env.L1_RPC_URL).toBe(process.env.L1_RPC_URL);
    expect(env.L1_RPC_URL).not.toBe(SAVED.L1_RPC_URL);
    expect(env.SAFE_API_KEY).toBe("saved-safe-key");
  });

  it("keeps settings saved under it in memory and never writes the file", async () => {
    const settings = await load({ LOCAL_SETTINGS_IGNORE: "L1_RPC_URL,L2_RPC_URL" });
    settings.saveLocalSettings({ L1_RPC_URL: "http://127.0.0.1:18545/" });
    expect(settings.localSetting("L1_RPC_URL")).toBe("http://127.0.0.1:18545/");
    expect(settings.localSetting("SAFE_API_KEY")).toBe("saved-safe-key");
    expect(fs.writes).toEqual([]);
    expect(JSON.parse(fs.files.get(PATH) as string)).toEqual(SAVED);
  });

  it("refuses a name it does not know, instead of silently honouring the saved one", async () => {
    await expect(load({ LOCAL_SETTINGS_IGNORE: "L1_RPC" })).rejects.toThrow(
      "LOCAL_SETTINGS_IGNORE names unknown settings: L1_RPC"
    );
  });
});

describe("IGNORE_LOCAL_SETTINGS=true (the hermetic suites)", () => {
  it("ignores every saved setting without reading the file, and never writes it", async () => {
    const settings = await load({
      IGNORE_LOCAL_SETTINGS: "true",
      LOCAL_SETTINGS_IGNORE: "L1_RPC_URL",
    });
    for (const name of Object.keys(SAVED)) expect(settings.localSetting(name)).toBeUndefined();
    expect(fs.reads).toEqual([]);
    settings.saveLocalSettings({ SAFE_API_KEY: "typed-in-a-test" });
    expect(settings.localSetting("SAFE_API_KEY")).toBe("typed-in-a-test");
    expect(fs.writes).toEqual([]);
  });
});

describe("neither (a normal run)", () => {
  it("honours every saved setting and writes saves to the file", async () => {
    const settings = await load({});
    expect(settings.localSetting("L1_RPC_URL")).toBe(SAVED.L1_RPC_URL);
    expect(settings.localSetting("SAFE_API_KEY")).toBe(SAVED.SAFE_API_KEY);
    settings.saveLocalSettings({ SAFE_API_KEY: null });
    expect(fs.writes).toEqual([`${PATH}.tmp`]);
    expect(JSON.parse(fs.files.get(PATH) as string)).toEqual({ ...SAVED, SAFE_API_KEY: null });
  });
});

describe("ignoredSettings", () => {
  it("reads the two switches", async () => {
    const { ignoredSettings } = await load({ IGNORE_LOCAL_SETTINGS: "true" });
    expect(ignoredSettings({}).all).toBe(false);
    expect([...ignoredSettings({}).names]).toEqual([]);
    expect([...ignoredSettings({ LOCAL_SETTINGS_IGNORE: " L2_RPC_URL ,," }).names]).toEqual([
      "L2_RPC_URL",
    ]);
    expect(ignoredSettings({ IGNORE_LOCAL_SETTINGS: "true" })).toMatchObject({ all: true });
    expect(ignoredSettings({ IGNORE_LOCAL_SETTINGS: "1" }).all).toBe(false);
  });
});
