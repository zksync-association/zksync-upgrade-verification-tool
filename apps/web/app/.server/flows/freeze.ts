import { securityCouncilAbi } from "@/common/abis";
import { type FreezeAction, type MemberSignature, freezeExecution } from "@/common/execution";
import { FREEZE_ACTIONS } from "@/common/freeze";
import { buildTypedData } from "@/common/typed-data";
import { FREEZE_STATUS_LABELS } from "@/common/upgrade-states";
import { formatNumber } from "@/utils/format";
import { type Address, type Hex, decodeFunctionData, isAddressEqual } from "viem";
import { FOREVER, cached } from "../cache";
import { callFn } from "../chain/call";
import { puhIndex } from "../chain/puh-index";
import type { Governance } from "../governance";
import { governanceFor } from "../page-governance";
import type { Freshness, SignatureSet } from "../signatures";
import {
  type ExecutionView,
  type SetState,
  type UsedSignature,
  blockTimeOf,
  callTo,
  compareUsedSignatures,
  executionFor,
  firstOrFresh,
  hasArchiveState,
  streamSignatureSet,
} from "./common";
import { firstFromHeld } from "./held";
import { type Collected, collectHeldMessages, collectMessages } from "./messages";

// Freeze requests live only as Security Council members' Safe messages. Their typed data holds
// everything (type, nonce, validUntil, threshold), so a request is fully described by its URL.

export type FreezeParams = {
  action: FreezeAction;
  nonce: string;
  validUntil: string;
  threshold?: string;
};

function nonceFor(gov: Governance, action: FreezeAction) {
  const n = gov.securityCouncil.nonces;
  return {
    SoftFreeze: n.softFreeze,
    HardFreeze: n.hardFreeze,
    Unfreeze: n.unfreeze,
    SetSoftFreezeThreshold: n.setSoftFreezeThreshold,
  }[action];
}

export function thresholdFor(gov: Governance, action: FreezeAction) {
  const t = gov.securityCouncil.thresholds;
  return {
    SoftFreeze: t.softFreeze,
    HardFreeze: t.hardFreeze,
    Unfreeze: t.unfreeze,
    SetSoftFreezeThreshold: t.softFreezeConservative,
  }[action];
}

/** Whether SecurityCouncil (and the handler behind it) would accept this request right now. */
export function freezeState(gov: Governance, params: FreezeParams): SetState {
  const current = BigInt(nonceFor(gov, params.action));
  const nonce = BigInt(params.nonce);
  const now = BigInt(gov.latestBlock.timestamp);
  if (nonce < current) {
    return {
      status: "done",
      detail: `Nonce ${nonce} was already used (executed or superseded)`,
      txHash: null,
    };
  }
  if (nonce > current)
    return { status: "closed", detail: `Waits for nonce ${current} to be used first` };
  if (BigInt(params.validUntil) <= now)
    return { status: "closed", detail: "The signatures expired (validUntil passed)" };

  const freeze = gov.freeze.lastFreezeStatus;
  const label = FREEZE_STATUS_LABELS[freeze] ?? `status ${freeze}`;
  if (params.action === "SoftFreeze" && freeze !== 0)
    return { status: "closed", detail: `Protocol is ${label.toLowerCase()}` };
  if (params.action === "HardFreeze" && ![0, 1, 3].includes(freeze)) {
    return { status: "closed", detail: `A hard freeze is not possible: ${label.toLowerCase()}` };
  }
  if (params.action === "Unfreeze" && ![1, 2].includes(freeze))
    return { status: "closed", detail: "The protocol is not frozen" };
  if (params.action === "SetSoftFreezeThreshold") {
    const t = BigInt(params.threshold ?? "0");
    if (t < 1n || t > BigInt(gov.securityCouncil.thresholds.softFreezeConservative)) {
      return {
        status: "closed",
        detail: `Threshold must be between 1 and ${gov.securityCouncil.thresholds.softFreezeConservative}`,
      };
    }
  }
  return { status: "open" };
}

// ---- A used nonce: the transaction that used it ----

const FREEZE_EVENT = {
  SoftFreeze: "SoftFreeze",
  HardFreeze: "HardFreeze",
  Unfreeze: "Unfreeze",
} as const;
const COUNCIL_FUNCTION = {
  SoftFreeze: "softFreeze",
  HardFreeze: "hardFreeze",
  Unfreeze: "unfreeze",
} as const;

type NonceUse = {
  txHash: Hex;
  blockNumber: bigint;
  /** Its call to the Security Council, when it can be read from the transaction. */
  call: { validUntil: bigint; signers: readonly Address[]; signatures: readonly Hex[] } | null;
};

function decodeCouncilCall(data: Hex, action: keyof typeof COUNCIL_FUNCTION) {
  try {
    const { functionName, args } = decodeFunctionData({ abi: securityCouncilAbi, data });
    if (functionName !== COUNCIL_FUNCTION[action]) return null;
    const [validUntil, signers, signatures] = args as [bigint, readonly Address[], readonly Hex[]];
    return { validUntil, signers, signatures };
  } catch {
    return null;
  }
}

/**
 * The transaction that used this nonce, from the handler's log history. Only the Security Council
 * can soft or hard freeze, so its nonce N went to the N-th SoftFreeze (HardFreeze) the handler
 * emitted since this Council took office. An Unfreeze also follows an expired freeze or an
 * emergency upgrade: there, the N-th one the Council itself called (read from the transaction).
 * Changing the soft-freeze threshold emits nothing: never found. Null when not found.
 */
function nonceUse(gov: Governance, params: FreezeParams): Promise<NonceUse | null> {
  const { action } = params;
  if (action === "SetSoftFreezeThreshold") return Promise.resolve(null);
  const council = gov.securityCouncil.address;
  const nonce = Number(params.nonce);
  return cached(`freeze-nonce-use:${council}:${action}:${nonce}`, 60_000, async () => {
    const index = puhIndex();
    const tookOffice = (await index.events("ChangeSecurityCouncil"))
      .filter((e) => isAddressEqual(e.args._securityCouncilAfter, council))
      .at(-1);
    if (!tookOffice) return null;
    const events = await index.events(FREEZE_EVENT[action], {
      fromBlock: tookOffice.log.blockNumber,
    });
    const callOf = async (txHash: Hex) => {
      const call = await callTo(txHash, council);
      return call ? decodeCouncilCall(call.data, action) : null;
    };
    if (action !== "Unfreeze") {
      const event = events[nonce];
      if (!event) return null;
      const { transactionHash: txHash, blockNumber } = event.log;
      return { txHash, blockNumber, call: await callOf(txHash) };
    }
    let seen = 0;
    for (const event of events) {
      const call = await callOf(event.log.transactionHash);
      if (!call) continue;
      if (seen === nonce)
        return { txHash: event.log.transactionHash, blockNumber: event.log.blockNumber, call };
      seen++;
    }
    return null;
  });
}

/** The soft-freeze threshold at a past block (it rises to 6 after each soft freeze); null without archive state. */
function softFreezeThresholdAt(council: Address, block: bigint): Promise<number | null> {
  // Kept once read (a past block's state never changes); "no archive state" is not kept.
  return cached(`soft-freeze-threshold:${council}:${block}`, FOREVER, async () => {
    if (!(await hasArchiveState(council, block))) throw new Error("no archive state");
    const value = await callFn<bigint>({
      address: council,
      abi: securityCouncilAbi,
      functionName: "softFreezeThreshold",
      blockNumber: block,
    });
    return Number(value);
  }).catch(() => null);
}

type UsedNonce = {
  /** Done when this request used it; closed when another request did. */
  state: SetState;
  /** The threshold the contract applied then, when it differs from today's and could be read. */
  threshold: number | null;
  used: { signers: readonly Address[]; signatures: readonly Hex[] } | null;
};

/** A used nonce: this request executed, or another one with the same nonce, and where. */
export async function usedNonce(gov: Governance, params: FreezeParams): Promise<UsedNonce> {
  const fallback: UsedNonce = {
    state: {
      status: "done",
      detail: `Nonce ${params.nonce} was already used (executed or superseded)`,
      txHash: null,
    },
    threshold: null,
    used: null,
  };
  let use: NonceUse | null;
  try {
    use = await nonceUse(gov, params);
  } catch {
    // The history could not be read now (an RPC error, the index still reading): said, never a
    // guess at which transaction it was.
    return {
      ...fallback,
      state: {
        status: "done",
        detail: `Nonce ${params.nonce} was already used; the transaction that used it could not be read now (refresh to retry)`,
        txHash: null,
      },
    };
  }
  if (!use) return fallback;
  if (!use.call)
    return {
      ...fallback,
      state: {
        status: "done",
        detail: `Nonce ${params.nonce} was used in ${use.txHash}; its call to the Security Council could not be read from that transaction`,
        txHash: null,
      },
    };
  if (use.call.validUntil !== BigInt(params.validUntil))
    return {
      ...fallback,
      state: {
        status: "closed",
        detail: `Superseded: nonce ${params.nonce} was used by another request (validUntil ${use.call.validUntil}) in ${use.txHash}`,
      },
    };
  const [threshold, at] = await Promise.all([
    params.action === "SoftFreeze"
      ? softFreezeThresholdAt(gov.securityCouncil.address, use.blockNumber - 1n)
      : null,
    blockTimeOf(use.blockNumber),
  ]);
  return {
    state: {
      status: "done",
      detail: `Executed in block #${formatNumber(use.blockNumber.toString())}${
        params.action === "SoftFreeze" && threshold === null
          ? " (the soft-freeze threshold then could not be read: the RPC keeps no past state)"
          : ""
      }`,
      txHash: use.txHash,
      at,
    },
    threshold,
    used: use.call,
  };
}

export type FreezeSummary = FreezeParams & {
  digest: string;
  reportedSigners: number;
  firstSeen: string;
  state: SetState;
};

export type FreezeList = {
  requests: FreezeSummary[];
  errors: string[];
  anomalies: number;
  governance: Governance;
  safeFetchedAt: string | null;
  /** True only for a page's first answer from Safe listings older than 60 s; false in JSON. */
  stale: boolean;
};

function freezeListFrom(gov: Governance, collected: Collected): FreezeList {
  const requests: FreezeSummary[] = collected.groups.map((group) => {
    const params: FreezeParams = {
      action: group.typedData.primaryType as FreezeAction,
      nonce: group.typedData.message.nonce as string,
      validUntil: group.typedData.message.validUntil as string,
      threshold: group.typedData.message.threshold,
    };
    return {
      ...params,
      digest: group.digest,
      reportedSigners: group.reportedSigners.length,
      firstSeen: group.firstSeen,
      state: freezeState(gov, params),
    };
  });
  return {
    requests,
    errors: collected.errors,
    anomalies: collected.anomalies,
    governance: gov,
    safeFetchedAt: collected.safeFetchedAt ?? null,
    stale: collected.stale === true,
  };
}

/** States are always read at the head (governance); only which requests exist may be old. */
export function loadFreezeList({ freshness = "strict" }: { freshness?: Freshness } = {}) {
  const gov = governanceFor(freshness);
  const fresh = gov.then(async (g) =>
    freezeListFrom(
      g,
      await collectMessages(g.securityCouncil.members, FREEZE_ACTIONS, g.securityCouncil.domain, {
        page: freshness === "page",
      })
    )
  );
  const first =
    freshness === "page"
      ? gov.then((g) =>
          firstFromHeld(
            collectHeldMessages(
              g.securityCouncil.members,
              FREEZE_ACTIONS,
              g.securityCouncil.domain
            ),
            fresh,
            (collected) => freezeListFrom(g, collected)
          )
        )
      : fresh;
  for (const promise of [first, fresh]) void promise.catch(() => {});
  return { first, fresh };
}

/**
 * For the sync engine: the list as a page shows it, from the Safe copies held (never asking Safe);
 * null when a member Safe's copy is not one a page would use as current.
 */
export async function heldFreezeList(): Promise<FreezeList | null> {
  const gov = await governanceFor("page");
  const collected = await collectHeldMessages(
    gov.securityCouncil.members,
    FREEZE_ACTIONS,
    gov.securityCouncil.domain
  );
  return collected && !collected.stale ? freezeListFrom(gov, collected) : null;
}

export function listFreezeRequests(): Promise<FreezeList> {
  return loadFreezeList().fresh;
}

export type FreezeDetail = {
  params: FreezeParams;
  set: SignatureSet;
  state: SetState;
  execution: ExecutionView | null;
  /** Executed: the signers and signatures its transaction carried, compared with Safe's copies. */
  used: UsedSignature[] | null;
  governance: Governance;
};

export function getFreezeRequest(
  params: FreezeParams,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
): Promise<FreezeDetail> {
  return loadFreezeRequest(params, { supplied }).fresh;
}

/** With `freshness: "page"`, `first` may be a labelled stale set, without an execution. */
export function loadFreezeRequest(
  params: FreezeParams,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
): { first: Promise<FreezeDetail>; fresh: Promise<FreezeDetail> } {
  const started = governanceFor(freshness).then(async (gov) => {
    const message: Record<string, string> = { nonce: params.nonce, validUntil: params.validUntil };
    if (params.action === "SetSoftFreezeThreshold") message.threshold = params.threshold ?? "0";
    const open = freezeState(gov, params);
    // A used nonce: where it was used, and the threshold the contract applied then.
    const used = open.status === "done" ? await usedNonce(gov, params) : null;
    const state = used?.state ?? open;
    const streamed = streamSignatureSet(
      {
        action: params.action,
        signerGroup: "securityCouncil",
        typedData: buildTypedData(params.action, gov.securityCouncil.domain, message),
        members: gov.securityCouncil.members,
        threshold: used?.threshold ?? thresholdFor(gov, params.action),
        check: { kind: "multisig", contract: gov.securityCouncil.address },
        supplied,
        open: state.status === "open",
        // Closed from validUntil on: a page showing it then reloads.
        openUntil: BigInt(params.validUntil),
      },
      freshness
    );
    return { gov, state, streamed, carried: used?.used ?? null };
  });
  const fresh = started.then(async ({ gov, state, streamed, carried }): Promise<FreezeDetail> => {
    const set = await streamed.fresh;
    const execution = await executionFor(
      set,
      state,
      (valid) =>
        freezeExecution(
          params.action,
          gov.securityCouncil.address,
          { validUntil: params.validUntil, threshold: params.threshold },
          valid
        ),
      { page: freshness === "page" }
    );
    const used = carried ? compareUsedSignatures(carried, set) : null;
    return { params, set, state, execution, used, governance: gov };
  });
  const first = started.then(({ gov, state, streamed, carried }) =>
    firstOrFresh([streamed], fresh, ([set]) => ({
      params,
      set: set as SignatureSet,
      state,
      execution: null,
      used: carried ? compareUsedSignatures(carried, set as SignatureSet) : null,
      governance: gov,
    }))
  );
  for (const pending of [first, fresh]) void pending.catch(() => {});
  return { first, fresh };
}
