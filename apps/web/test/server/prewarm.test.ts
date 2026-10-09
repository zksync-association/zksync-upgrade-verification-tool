import type { Governance } from "@/.server/governance";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The boot / settings warm-up: order of its steps, that it never rejects, that its logs carry no
// RPC URL or key, and the PREWARM=0 switch. Every dependency is a stub that records its calls.

type LogRecord = { level: "info" | "warn"; fields: Record<string, unknown>; message: string };

const state = vi.hoisted(() => ({
  generation: 0,
  events: [] as string[],
  records: [] as LogRecord[],
  network: null as null | (() => Promise<unknown>),
  governance: null as null | (() => Promise<unknown>),
  logHistory: null as null | (() => Promise<unknown>),
  backfill: null as null | (() => Promise<void>),
  l2Backfill: null as null | (() => Promise<void>),
  listing: null as null | ((safe: string) => Promise<unknown>),
  // SAFE_API_KEY set or a self-hosted service (safe-api backgroundSafeReadsAllowed).
  safeBackground: true,
  indexStatus: {
    state: "ready",
    strategy: "chunked",
    chunks: { done: 435, total: 435 },
    logs: 98,
  } as Record<string, unknown>,
  l2IndexStatus: { state: "ready", strategy: "full-range", logs: 81 } as Record<string, unknown>,
}));

vi.mock("@config/log.server", () => {
  const record = (level: "info" | "warn") => (fields: Record<string, unknown>, message: string) =>
    state.records.push({ level, fields, message });
  const logger = { info: record("info"), warn: record("warn"), child: () => logger };
  return { defaultLogger: logger };
});

vi.mock("@/.server/rpc", () => ({
  l1: { client: "l1" },
  network: vi.fn(() => state.network?.()),
  rpcGeneration: () => state.generation,
}));

vi.mock("@/.server/governance", () => ({
  governance: vi.fn(() => state.governance?.()),
}));

vi.mock("@/.server/logs", () => ({
  checkLogHistory: vi.fn(() => state.logHistory?.()),
}));

vi.mock("@/.server/chain/puh-index", () => ({
  puhIndex: () => ({
    startBackfill: vi.fn(() => state.backfill?.()),
    status: () => state.indexStatus,
  }),
}));

vi.mock("@/.server/chain/l2-index", () => ({
  l2GovernorIndex: () => ({
    startBackfill: vi.fn(() => state.l2Backfill?.()),
    status: () => state.l2IndexStatus,
  }),
}));

vi.mock("@/.server/safe/store", () => ({
  warmSafeListing: vi.fn((safe: string) => state.listing?.(safe)),
}));

vi.mock("@/.server/safe-api", () => ({
  backgroundSafeReadsAllowed: vi.fn(() => state.safeBackground),
}));

vi.mock("@/.server/flows/messages", () => ({
  warmMessageReadings: vi.fn(async (safes: string[]) => {
    state.events.push(`messages:${safes.length}`);
    return 42;
  }),
}));

const { governanceSafes, prewarm, shouldPrewarm } = await import("@/.server/prewarm");
const { network } = await import("@/.server/rpc");
const { governance } = await import("@/.server/governance");
const { checkLogHistory } = await import("@/.server/logs");
const { backgroundSafeReadsAllowed } = await import("@/.server/safe-api");
// The warm-up's reads go through the Safe store at low priority (safe-store.test.ts).
const { warmSafeListing: listSafeMessages } = await import("@/.server/safe/store");
const { warmMessageReadings } = await import("@/.server/flows/messages");

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const SC = [address(1), address(2), address(3)];
// One Guardian is also a Security Council member (lower case): listed once.
const G = [address(4), address(2).toLowerCase() as Address, address(5)];
const ZKF = address(6);
const GOV = {
  securityCouncil: { members: SC },
  guardians: { members: G },
  emergencyUpgradeBoard: { zkFoundation: ZKF },
} as unknown as Governance;
const NET = { chainId: 1, safeTxServiceUrl: "https://api.safe.global/tx-service/eth" };

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A dependency that records when it starts and ends, and waits for `gate` when given one. */
function tracked<T>(name: string, value: () => T, gate?: Promise<unknown>) {
  return async () => {
    state.events.push(`${name}:start`);
    await gate;
    state.events.push(`${name}:end`);
    return value();
  };
}

const steps = () => state.records.map((r) => r.fields.step);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  state.generation = 0;
  state.safeBackground = true;
  state.events = [];
  state.records = [];
  state.network = tracked("network", () => NET);
  state.governance = tracked("governance", () => GOV);
  state.logHistory = tracked("log-history", () => ({ status: "ok" }));
  state.backfill = tracked("log-index", () => undefined);
  state.l2Backfill = tracked("l2-index", () => undefined);
  state.listing = async (safe) => {
    state.events.push(`safe:start:${safe}`);
    await flush();
    state.events.push(`safe:end:${safe}`);
    return { messages: [], complete: true };
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("prewarm", () => {
  it("reads the network, then governance, canary and backfill together, and Safe listings one at a time once governance is in", async () => {
    const gov = deferred();
    const history = deferred();
    const index = deferred();
    const l2 = deferred();
    state.governance = tracked("governance", () => GOV, gov.promise);
    state.logHistory = tracked("log-history", () => ({ status: "ok" }), history.promise);
    state.backfill = tracked("log-index", () => undefined, index.promise);
    state.l2Backfill = tracked("l2-index", () => undefined, l2.promise);

    let finished = false;
    const run = prewarm("boot").then(() => {
      finished = true;
    });
    await flush();
    // The three middle steps start together, after the network and before anything else; the
    // L2 governors' backfill starts beside them.
    expect(state.events).toEqual([
      "network:start",
      "network:end",
      "l2-index:start",
      "governance:start",
      "log-history:start",
      "log-index:start",
    ]);
    await flush();
    // Safe listings wait for governance (the member Safes)...
    expect(state.events.some((e) => e.startsWith("safe:"))).toBe(false);

    gov.resolve();
    // ...and only for it: they all run while the canary and the backfill are still going (the
    // Safe service is another upstream), so a page opened during the backfill finds them.
    for (let i = 0; i < 20 && !state.events.includes(`safe:end:${ZKF}`); i++) await flush();
    expect(state.events).toContain(`safe:end:${ZKF}`);
    expect(state.events).not.toContain("log-history:end");
    expect(state.events).not.toContain("log-index:end");

    history.resolve();
    index.resolve();
    // Nothing waits for the L2 backfill; the run itself ends (and logs "done") only once its step
    // has.
    for (let i = 0; i < 5; i++) await flush();
    expect(state.events).toContain("log-index:end");
    expect(state.events).not.toContain("l2-index:end");
    expect(finished).toBe(false);
    l2.resolve();
    await run;
    const safeEvents = state.events.filter((e) => e.startsWith("safe:"));
    const order = [...SC, address(4), address(5), ZKF];
    // One at a time: each listing ends before the next starts; SC, then Guardians, then ZKF.
    expect(safeEvents).toEqual(order.flatMap((safe) => [`safe:start:${safe}`, `safe:end:${safe}`]));
    expect(listSafeMessages).toHaveBeenCalledTimes(order.length);
    expect(checkLogHistory).toHaveBeenCalledWith({ client: "l1" });
    // Then the messages of the listings held are read (parsed and hashed), once all are in.
    expect(warmMessageReadings).toHaveBeenCalledTimes(1);
    expect(warmMessageReadings).toHaveBeenCalledWith(order);
    expect(state.events.indexOf("messages:6")).toBeGreaterThan(
      state.events.indexOf(`safe:end:${ZKF}`)
    );

    expect(steps()).toEqual([
      "network",
      "governance",
      "safe-listings",
      "safe-messages",
      "log-history",
      "log-index",
      "l2-index",
      "done",
    ]);
    const backfill = state.records.find((r) => r.fields.step === "log-index");
    expect(backfill?.fields).toMatchObject({ reason: "boot", state: "ready", logs: 98 });
    const l2Backfill = state.records.find((r) => r.fields.step === "l2-index");
    expect(l2Backfill?.fields).toMatchObject({
      reason: "boot",
      state: "ready",
      strategy: "full-range",
      logs: 81,
    });
    const listings = state.records.find((r) => r.fields.step === "safe-listings");
    expect(listings?.fields).toMatchObject({ listed: 6, of: 6 });
    const messages = state.records.find((r) => r.fields.step === "safe-messages");
    expect(messages?.fields).toMatchObject({ reason: "boot", read: 42 });
    for (const record of state.records) expect(typeof record.fields.ms).toBe("number");
  });

  it("lists SC members, then Guardians, then the ZK Foundation, each Safe once", () => {
    expect(governanceSafes(GOV)).toEqual([...SC, address(4), address(5), ZKF]);
  });

  it("resolves when the network read rejects, and skips everything that depends on it", async () => {
    state.network = async () => {
      throw new Error("down");
    };
    const l2 = vi.fn(async () => {});
    state.l2Backfill = l2;
    await expect(prewarm("boot")).resolves.toBeUndefined();
    expect(governance).not.toHaveBeenCalled();
    expect(checkLogHistory).not.toHaveBeenCalled();
    expect(listSafeMessages).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
    expect(state.records.map((r) => [r.level, r.fields.step])).toEqual([
      ["warn", "network"],
      ["info", "done"],
    ]);
  });

  it("resolves when every dependency rejects", async () => {
    const fail = async () => {
      throw new Error("upstream failed");
    };
    state.governance = fail;
    state.logHistory = fail;
    state.backfill = fail;
    state.l2Backfill = fail;
    state.listing = fail;
    await expect(prewarm("boot")).resolves.toBeUndefined();
    // Without governance there is nothing to list.
    expect(listSafeMessages).not.toHaveBeenCalled();
    expect(warmMessageReadings).not.toHaveBeenCalled();
    const failed = state.records.filter((r) => r.level === "warn").map((r) => r.fields.step);
    expect(failed.sort()).toEqual(["governance", "l2-index", "log-history", "log-index"]);

    // Synchronous throws are failures too.
    state.records = [];
    state.network = () => {
      throw new Error("sync");
    };
    await expect(prewarm("settings")).resolves.toBeUndefined();
  });

  it("stops the Safe listings at the first failure (a rate limit), without rejecting", async () => {
    state.listing = async () => {
      throw Object.assign(new Error("Safe Transaction Service is temporarily rate limited"), {
        name: "SafeApiError",
      });
    };
    await expect(prewarm("boot")).resolves.toBeUndefined();
    expect(listSafeMessages).toHaveBeenCalledTimes(1);
    const listings = state.records.find((r) => r.fields.step === "safe-listings");
    expect(listings).toMatchObject({
      level: "warn",
      fields: { error: "SafeApiError", listed: 0, of: 6 },
    });
  });

  it("skips Safe listings on a chain without a Safe Transaction Service", async () => {
    state.network = async () => ({ ...NET, safeTxServiceUrl: null });
    await prewarm("boot");
    expect(listSafeMessages).not.toHaveBeenCalled();
    expect(state.records.find((r) => r.fields.step === "safe-listings")?.fields).toMatchObject({
      skipped: "no-service",
    });
  });

  it("skips Safe listings on the public service without SAFE_API_KEY (its monthly quota)", async () => {
    state.safeBackground = false;
    await expect(prewarm("boot")).resolves.toBeUndefined();
    expect(backgroundSafeReadsAllowed).toHaveBeenCalledWith(NET.safeTxServiceUrl);
    expect(listSafeMessages).not.toHaveBeenCalled();
    expect(state.records.find((r) => r.fields.step === "safe-listings")?.fields).toMatchObject({
      skipped: "keyless-public-service",
    });
    // Everything else still ran (the L2 backfill beside it).
    const ran = steps();
    expect(ran.at(-1)).toBe("done");
    expect(ran.slice(0, 2)).toEqual(["network", "governance"]);
    expect([...ran].sort()).toEqual([
      "done",
      "governance",
      "l2-index",
      "log-history",
      "log-index",
      "network",
      "safe-listings",
      "safe-messages",
    ]);
    // The listings the last run kept are held: their messages are read all the same.
    expect(warmMessageReadings).toHaveBeenCalledTimes(1);
  });

  it("never logs an RPC URL, host, key or error text", async () => {
    const url = "https://rpc.example.com/v3/SECRETKEY123?apikey=SECRETKEY123";
    const leaky = () => {
      const error = new Error(`HTTP request failed. URL: ${url} Details: boom`);
      // Even an error whose name is the URL is logged as a plain class name.
      error.name = url;
      return error;
    };
    state.governance = async () => {
      throw leaky();
    };
    state.logHistory = async () => ({ status: "error", message: `eth_getLogs failed at ${url}` });
    state.backfill = async () => {
      throw Object.assign(new Error(url), { name: "HttpRequestError" });
    };
    state.l2Backfill = async () => {
      throw leaky();
    };
    await prewarm("boot");

    // Governance worked this time; the listings fail with the URL in the message.
    state.governance = async () => GOV;
    state.listing = async () => {
      throw leaky();
    };
    await prewarm("settings");

    // And the network read itself.
    state.network = async () => {
      throw leaky();
    };
    await prewarm("boot");

    const logged = JSON.stringify(state.records);
    expect(state.records.length).toBeGreaterThan(5);
    expect(logged).not.toContain("rpc.example.com");
    expect(logged).not.toContain("SECRETKEY123");
    expect(logged).not.toContain("https://");
    expect(logged).not.toContain("boom");
    expect(logged).not.toContain("eth_getLogs failed");
    const errors = state.records.flatMap((r) => (r.fields.error ? [r.fields.error] : []));
    expect(errors).toContain("Error");
    expect(errors).toContain("HttpRequestError");
  });

  it("is off with PREWARM=0", async () => {
    vi.stubEnv("PREWARM", "0");
    await expect(prewarm("boot")).resolves.toBeUndefined();
    await expect(prewarm("settings")).resolves.toBeUndefined();
    expect(network).not.toHaveBeenCalled();
    expect(governance).not.toHaveBeenCalled();
    expect(listSafeMessages).not.toHaveBeenCalled();
    expect(state.records).toEqual([]);
  });

  it("reads PREWARM: 0, false, off and no turn it off; anything else leaves it on", () => {
    for (const off of ["0", "false", "OFF", " no "])
      expect(shouldPrewarm({ PREWARM: off })).toBe(false);
    for (const on of [undefined, "", "1", "true", "yes"])
      expect(shouldPrewarm({ PREWARM: on })).toBe(true);
  });

  it("runs once per settings generation at a time, and a settings change supersedes a run", async () => {
    const gov = deferred();
    state.governance = tracked("governance", () => GOV, gov.promise);
    const first = prewarm("boot");
    expect(prewarm("boot")).toBe(first);
    await flush();
    expect(network).toHaveBeenCalledTimes(1);

    // Settings change while governance is read: the old run stops before the Safe listings, and
    // the new settings get a run of their own.
    state.generation = 1;
    state.governance = tracked("governance", () => GOV);
    const second = prewarm("settings");
    expect(second).not.toBe(first);
    await second;
    expect(listSafeMessages).toHaveBeenCalledTimes(6);

    gov.resolve();
    await first;
    expect(listSafeMessages).toHaveBeenCalledTimes(6);
    const boot = state.records.filter((r) => r.fields.reason === "boot").map((r) => r.fields.step);
    // Steps log as they finish: governance, held back above, comes last of the three.
    expect(boot.filter((step) => step !== "l2-index")).toEqual([
      "network",
      "log-history",
      "log-index",
      "governance",
      "superseded",
      "done",
    ]);
    expect(boot).toContain("l2-index");

    // Once a run ends, a later call starts a new one.
    vi.clearAllMocks();
    await prewarm("settings");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("stops listing Safes once the settings change", async () => {
    let listed = 0;
    state.listing = async () => {
      if (++listed === 2) state.generation = 5;
      return { messages: [], complete: true };
    };
    await prewarm("boot");
    expect(listSafeMessages).toHaveBeenCalledTimes(2);
    expect(steps().filter((step) => step === "superseded")).toHaveLength(1);
    expect(warmMessageReadings).not.toHaveBeenCalled();
    expect(state.records.find((r) => r.fields.step === "safe-listings")?.fields).toMatchObject({
      listed: 2,
      of: 6,
    });
  });
});
