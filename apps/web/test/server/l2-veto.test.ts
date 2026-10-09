import { clearCache } from "@/.server/cache";
import { l2GovernorAbi } from "@/common/abis";
import {
  type Address,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Hex,
  HttpRequestError,
  type PublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  toHex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_URL } from "../support/fake-calls";

// A Guardians veto page reads the L2 proposal it cancels from ZKsync Era. "Not found" is an
// answer about the governor; an L2 read that failed must never read as one (nor close the veto):
// the detail says the proposal could not be read, and why, without the RPC URL.

const TOKEN_GOVERNOR: Address = "0x0000000000000000000000000000000000000a01";
const GUARDIANS: Address = "0x0000000000000000000000000000000000000a02";
const SIGNER: Address = "0x0000000000000000000000000000000000000d01";

function proposalOf(description: string) {
  const content = {
    targets: ["0x0000000000000000000000000000000000000b01"] as Address[],
    values: [0n],
    calldatas: ["0x1234"] as Hex[],
    description,
  };
  const id = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [content.targets, content.values, content.calldatas, keccak256(toHex(description))]
      )
    )
  );
  const created = getAbiItem({ abi: l2GovernorAbi, name: "ProposalCreated" });
  const log = {
    address: TOKEN_GOVERNOR,
    topics: encodeEventTopics({ abi: l2GovernorAbi, eventName: "ProposalCreated" }),
    data: encodeAbiParameters(created.inputs, [
      id,
      "0x0000000000000000000000000000000000000c01",
      content.targets,
      content.values,
      [""],
      content.calldatas,
      100n,
      200n,
      description,
    ]),
    transactionHash: `0x${"ab".repeat(32)}`,
  };
  return { id, log };
}

const vetoed = proposalOf("Raise the limit");
const other = proposalOf("Something else");

const state = vi.hoisted(() => ({
  l2Configured: true,
  // Governor.state(id) for the vetoed proposal, and for any other one: a value or an error.
  l2State: 1 as number | Error,
  otherState: 1 as number | Error,
  // Governor.proposalSnapshot(id): 0 when the governor has no such proposal.
  snapshot: 150n as bigint | Error,
  logs: [] as unknown[],
}));

vi.mock("@/.server/logs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/.server/logs")>()),
  findBlockByTimestamp: async () => 1n,
  getLogs: async () => state.logs,
}));

const answer = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};
const client = {
  getBlock: async () => ({ number: 1_000n, timestamp: 10_000_000n }),
  readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    if (functionName === "proposalSnapshot") return answer(state.snapshot);
    if (functionName === "votingDelay") return 50n;
    if (functionName === "state")
      return answer(args?.[0] === vetoed.id ? state.l2State : state.otherState);
    throw new Error(`unexpected ${functionName}`);
  },
} as unknown as PublicClient;

vi.mock("@/.server/rpc", () => ({
  network: async () => ({
    chainId: 1,
    isDevNode: false,
    l2RpcUrl: state.l2Configured ? SECRET_URL : null,
    l2Governors: { token: TOKEN_GOVERNOR, govOps: null, protocol: null },
  }),
  l2: async () => (state.l2Configured ? client : null),
  l1: { readContract: async () => vetoed.id },
}));

const gov = {
  guardians: {
    address: GUARDIANS,
    nonce: "0",
    members: [SIGNER],
    thresholds: { cancelL2Proposal: 1 },
    domain: { name: "Guardians", version: "1", chainId: 1, verifyingContract: GUARDIANS },
  },
};
// JSON's governance and pages', told apart (a page reads its own; see page-governance.ts).
const govReads = vi.hoisted(() => ({ json: 0, page: 0 }));
vi.mock("@/.server/governance", () => ({
  governance: async () => {
    govReads.json++;
    return gov;
  },
}));
vi.mock("@/.server/page-governance", () => {
  const page = async () => {
    govReads.page++;
    return gov;
  };
  return {
    pageGovernance: page,
    governanceFor: async (freshness: string) => {
      if (freshness === "page") return page();
      govReads.json++;
      return gov;
    },
  };
});
const sets = vi.hoisted(() => ({ firstStale: false }));
vi.mock("@/.server/signatures", () => ({
  verifySignatureSet: async () => ({
    thresholdCheck: { status: "met" },
    valid: [{ signer: SIGNER, signature: "0xaa" }],
    members: [],
    stale: false,
  }),
  // A page's current result (the same here).
  verifyPageSignatureSet: async () => ({
    thresholdCheck: { status: "met" },
    valid: [{ signer: SIGNER, signature: "0xaa" }],
    members: [],
    stale: false,
  }),
  // A page's first answer: met at an older block (stale), or the fresh result.
  firstSignatureSet: async (_params: unknown, fresh: Promise<unknown>) =>
    sets.firstStale
      ? {
          thresholdCheck: { status: "met" },
          valid: [{ signer: SIGNER, signature: "0xaa" }],
          members: [],
          verifiedAtBlock: "90",
          stale: true,
        }
      : fresh,
  simulate: async () => ({ status: "ok" }),
  // The key a page reports while it shows the set.
  watchSignatureSet: () => ({ key: "set:0123456789abcdef0123456789abcdef", rev: null }),
}));
// Members' Safe messages: the fresh listings (`collectMessages`, which a test may hold) and the
// copies held now, whatever their age (`collectHeldMessages`).
const messages = vi.hoisted(() => ({
  fresh: null as unknown,
  held: null as unknown,
  gate: null as Promise<void> | null,
}));
vi.mock("@/.server/flows/messages", () => ({
  collectMessages: async () => {
    await messages.gate;
    return messages.fresh ?? { groups: [], errors: [], anomalies: 0 };
  },
  collectHeldMessages: async () => messages.held,
}));

const { getL2Veto, listL2Vetoes, loadL2Veto, loadL2VetoList } = await import(
  "@/.server/flows/l2-veto"
);
const { listFreezeRequests, loadFreezeList, loadFreezeRequest } = await import(
  "@/.server/flows/freeze"
);

const params = {
  l2ProposalId: vetoed.id.toString(),
  l2GovernorAddress: TOKEN_GOVERNOR,
  l2GasLimit: "1000000",
  l2GasPerPubdataByteLimit: "800",
  refundRecipient: GUARDIANS,
  txMintValue: "0",
  nonce: "0",
};

/** What viem's readContract throws when the node answers -32603 (or code 3: viem cannot tell). */
const internalError = () =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: l2GovernorAbi,
      functionName: "state",
      message: "internal error",
    }),
    {
      abi: l2GovernorAbi,
      functionName: "state",
      args: [vetoed.id],
      contractAddress: TOKEN_GOVERNOR,
    }
  );

beforeEach(() => {
  clearCache();
  messages.fresh = null;
  messages.held = null;
  messages.gate = null;
  sets.firstStale = false;
  state.l2Configured = true;
  state.l2State = 1;
  state.otherState = 1;
  state.snapshot = 150n;
  state.logs = [vetoed.log];
});

describe("getL2Veto", () => {
  it("reads an Active proposal, checks its id, and builds the execution", async () => {
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toMatchObject({ state: "Active", idMatchesLocal: true });
    expect(detail.l2Error).toBeNull();
    expect(detail.state).toEqual({ status: "open" });
    expect(detail.execution?.to).toBe(GUARDIANS);
  });

  it("reports a proposal the governor does not have as not found, which is an answer", async () => {
    state.snapshot = 0n;
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toBeNull();
  });

  it.each([
    [
      "state() fails with -32603",
      () => {
        state.l2State = internalError();
      },
    ],
    [
      "proposalSnapshot() fails",
      () => {
        state.snapshot = internalError();
      },
    ],
    [
      "the L2 RPC is down",
      () => {
        state.l2State = new HttpRequestError({ url: SECRET_URL, status: 503 });
      },
    ],
  ])("never reads as not found when %s", async (_name, fail) => {
    fail();
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toEqual(expect.any(String));
    expect(detail.l2Error).not.toBe("");
    // A failed read neither closes the veto nor builds an execution without the content.
    expect(detail.state).toEqual({ status: "open" });
    expect(detail.execution).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("secret-host");
  });

  it("keeps the RPC URL and its key out of the error", async () => {
    state.l2State = new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
    const { l2Error } = await getL2Veto(params);
    expect(l2Error).toContain("fetch failed");
    expect(l2Error).not.toContain("secret-host");
    expect(l2Error).not.toContain("0123456789abcdef");
  });

  it("says no ZKsync Era RPC is configured instead of not found", async () => {
    state.l2Configured = false;
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toBeNull();
    expect(detail.l2Error).toMatch(/No ZKsync Era RPC/);
  });

  it("is not failed by another proposal's state read", async () => {
    state.logs = [other.log, vetoed.log];
    state.otherState = internalError();
    const detail = await getL2Veto(params);
    expect(detail.l2Proposal).toMatchObject({ proposalId: vetoed.id.toString(), state: "Active" });
    expect(detail.l2Error).toBeNull();
  });
});

describe("listL2Vetoes", () => {
  it("reports a failed vetoable list without the RPC URL", async () => {
    state.l2State = new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
    const result = await listL2Vetoes();
    expect(result.vetoable).toEqual([]);
    expect(result.l2Error).toContain("fetch failed");
    expect(result.l2Error).not.toContain("secret-host");
  });
});

describe("a page's first answer for a veto or a freeze request", () => {
  it("is a stale set with nothing to send, before the strict result with its execution", async () => {
    sets.firstStale = true;
    const veto = loadL2Veto(params, { freshness: "page" });
    const first = await veto.first;
    expect(first.set).toMatchObject({ stale: true, verifiedAtBlock: "90" });
    expect(first.execution).toBeNull();
    expect(first.state).toEqual({ status: "open" });
    expect(first.l2Proposal).toMatchObject({ state: "Active" });
    const fresh = await veto.fresh;
    expect(fresh.set.stale).toBe(false);
    expect(fresh.execution?.to).toBe(GUARDIANS);
    // JSON never gets the stale one.
    expect((await getL2Veto(params)).set.stale).toBe(false);
  });

  it("checks the L2 proposal's id at the Guardians the page's governance names, never JSON's full read", async () => {
    state.logs = [other.log, vetoed.log];
    govReads.json = 0;
    govReads.page = 0;
    const veto = loadL2Veto(params, { freshness: "page" });
    const fresh = await veto.fresh;
    expect(fresh.l2Proposal).toMatchObject({ idMatchesLocal: true, idMatchesContract: true });
    expect(await veto.first).toBe(fresh);
    expect(govReads).toEqual({ json: 0, page: 1 });
    // The vetoable list on the page (a governor read by its window, not the index): the same.
    const list = loadL2VetoList({ freshness: "page" });
    const vetoable = await list.freshVetoable;
    await list.signed;
    // (Each id read on L1; this file's L1 answers the vetoed proposal's id for any content.)
    expect(vetoable.vetoable.map((p) => p.idMatchesContract)).toEqual([false, true]);
    expect(govReads).toEqual({ json: 0, page: 2 });
    // JSON's detail keeps JSON's governance.
    clearCache();
    expect((await getL2Veto(params)).l2Proposal).toMatchObject({ idMatchesContract: true });
    expect(govReads).toEqual({ json: 1, page: 2 });
  });

  it("is the strict result itself when nothing older is shown", async () => {
    const veto = loadL2Veto(params, { freshness: "page" });
    expect(await veto.first).toBe(await veto.fresh);
    const strict = loadL2Veto(params);
    expect(await strict.first).toBe(await strict.fresh);
  });

  it("freeze requests stream the same way", async () => {
    const { governance } = await import("@/.server/governance");
    const council = {
      address: GUARDIANS,
      members: [SIGNER],
      nonces: { softFreeze: "0", hardFreeze: "0", unfreeze: "0", setSoftFreezeThreshold: "0" },
      thresholds: { softFreeze: 1, hardFreeze: 1, unfreeze: 1, softFreezeConservative: 1 },
      domain: { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: GUARDIANS },
    };
    // The governance this file serves, with a Security Council for the duration of the test.
    const served = (await governance()) as unknown as Record<string, unknown>;
    const extra = {
      securityCouncil: council,
      latestBlock: { timestamp: "100" },
      freeze: { lastFreezeStatus: 0 },
    };
    Object.assign(served, extra);
    try {
      sets.firstStale = true;
      const request = { action: "SoftFreeze" as const, nonce: "0", validUntil: "1000" };
      const freeze = loadFreezeRequest(request, { freshness: "page" });
      const first = await freeze.first;
      expect(first.set.stale).toBe(true);
      expect(first.execution).toBeNull();
      const fresh = await freeze.fresh;
      expect(fresh.set.stale).toBe(false);
      expect(fresh.execution?.to).toBe(GUARDIANS);
    } finally {
      for (const key of Object.keys(extra)) delete served[key];
    }
  });
});

/** Safe answers wait until the returned release is called. */
function holdSafe() {
  let release!: () => void;
  messages.gate = new Promise((resolve) => {
    release = resolve;
  });
  return release;
}

/** Whether `promise` settled within a few ms. */
async function settles(promise: Promise<unknown>, ms = 30): Promise<boolean> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return done;
}

/** A message group as collected from members' Safes, for typed data `message` of `primaryType`. */
const group = (primaryType: string, message: Record<string, string>, n: number) => ({
  digest: `0x${n.toString(16).padStart(64, "0")}`,
  typedData: { primaryType, message },
  reportedSigners: [SIGNER],
  firstSeen: "2026-10-01T10:00:00.000Z",
  lastSeen: "2026-10-01T10:00:00.000Z",
});
const OLD = "2026-10-01T10:00:00.000Z";
const NOW = "2026-10-07T10:00:00.000Z";
const collected = (groups: unknown[], fetchedAt: string, stale: boolean) => ({
  groups,
  errors: [],
  anomalies: 0,
  safeFetchedAt: fetchedAt,
  stale,
});

describe("a page's first list of vetoes", () => {
  const veto = (nonce: number) =>
    group("CancelL2GovernorProposal", { ...params, nonce: String(nonce) }, nonce + 1);

  it("comes from Safe copies of any age, labelled, and the fresh list follows; JSON waits for it", async () => {
    messages.held = collected([veto(0)], OLD, true);
    messages.fresh = collected([veto(0), veto(1)], NOW, false);
    const release = holdSafe();
    const loading = loadL2VetoList({ freshness: "page" });
    const first = await loading.signed;
    expect(first).toMatchObject({ stale: true, safeFetchedAt: OLD });
    expect(first.vetoes.map((v) => v.nonce)).toEqual(["0"]);
    // Each veto's state is read at the head (governance), whatever the copies' age.
    expect(first.vetoes[0]?.state).toEqual({ status: "open" });
    expect(await settles(loading.freshSigned)).toBe(false);
    const json = listL2Vetoes();
    expect(await settles(json)).toBe(false);
    release();
    const fresh = await loading.freshSigned;
    expect(fresh).toMatchObject({ stale: false, safeFetchedAt: NOW });
    expect(fresh.vetoes.map((v) => v.nonce)).toEqual(["0", "1"]);
    // JSON: the fresh list only, in its documented shape.
    const result = await json;
    expect(result.vetoes.map((v) => v.nonce)).toEqual(["0", "1"]);
    expect(Object.keys(result).sort()).toEqual(
      ["anomalies", "errors", "governance", "l2Error", "vetoable", "vetoes"].sort()
    );
  });

  it("is the fresh list itself when no copy held is older than 60 s, or none is held", async () => {
    messages.fresh = collected([veto(0)], NOW, false);
    for (const held of [null, collected([veto(0)], NOW, false)]) {
      messages.held = held;
      const loading = loadL2VetoList({ freshness: "page" });
      expect(await loading.signed).toBe(await loading.freshSigned);
    }
  });

  it("lists the vetoable proposals on their own, never waiting for Safe", async () => {
    holdSafe();
    const loading = loadL2VetoList({ freshness: "page" });
    const vetoable = await loading.vetoable;
    expect(vetoable).toMatchObject({ l2Error: null, fromLastRun: false });
    expect(vetoable.vetoable.map((p) => p.proposalId)).toEqual([vetoed.id.toString()]);
    expect(await loading.freshVetoable).toBe(vetoable);
    expect(await settles(loading.signed)).toBe(false);
  });

  it("says why the vetoable proposals could not be read, never an empty list as an answer", async () => {
    state.l2State = new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${SECRET_URL}`);
    const vetoable = await loadL2VetoList({ freshness: "page" }).vetoable;
    expect(vetoable.vetoable).toEqual([]);
    expect(vetoable.l2Error).toContain("fetch failed");
    expect(vetoable.l2Error).not.toContain("secret-host");
  });
});

describe("a page's first list of freeze requests", () => {
  it("comes from Safe copies of any age, labelled, and the fresh list follows; JSON waits for it", async () => {
    const { governance } = await import("@/.server/governance");
    const served = (await governance()) as unknown as Record<string, unknown>;
    const extra = {
      securityCouncil: {
        address: GUARDIANS,
        members: [SIGNER],
        nonces: { softFreeze: "1", hardFreeze: "0", unfreeze: "0", setSoftFreezeThreshold: "0" },
        thresholds: { softFreeze: 1, hardFreeze: 1, unfreeze: 1, softFreezeConservative: 1 },
        domain: { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: GUARDIANS },
      },
      latestBlock: { timestamp: "100" },
      freeze: { lastFreezeStatus: 0 },
    };
    Object.assign(served, extra);
    try {
      const request = (nonce: number) =>
        group("SoftFreeze", { nonce: String(nonce), validUntil: "1000" }, nonce + 1);
      messages.held = collected([request(0)], OLD, true);
      messages.fresh = collected([request(0), request(1)], NOW, false);
      const release = holdSafe();
      const loading = loadFreezeList({ freshness: "page" });
      const first = await loading.first;
      expect(first).toMatchObject({ stale: true, safeFetchedAt: OLD });
      // States at the head: nonce 0 is used already, whatever the copies' age.
      expect(first.requests.map((r) => r.state.status)).toEqual(["done"]);
      const json = listFreezeRequests();
      expect(await settles(json)).toBe(false);
      release();
      const fresh = await loading.fresh;
      expect(fresh).toMatchObject({ stale: false, safeFetchedAt: NOW });
      expect(fresh.requests.map((r) => [r.nonce, r.state.status])).toEqual([
        ["0", "done"],
        ["1", "open"],
      ]);
      expect((await json).stale).toBe(false);
      expect((await json).requests).toHaveLength(2);
    } finally {
      for (const key of Object.keys(extra)) delete served[key];
    }
  });
});
