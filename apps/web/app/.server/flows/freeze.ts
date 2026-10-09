import { type FreezeAction, type MemberSignature, freezeExecution } from "@/common/execution";
import { FREEZE_ACTIONS } from "@/common/freeze";
import { buildTypedData } from "@/common/typed-data";
import { FREEZE_STATUS_LABELS } from "@/common/upgrade-states";
import { type Governance, governance } from "../governance";
import type { Freshness, SignatureSet } from "../signatures";
import {
  type ExecutionView,
  type SetState,
  executionFor,
  firstOrFresh,
  streamSignatureSet,
} from "./common";
import { collectMessages } from "./messages";

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

export type FreezeSummary = FreezeParams & {
  digest: string;
  reportedSigners: number;
  firstSeen: string;
  state: SetState;
};

export async function listFreezeRequests() {
  const gov = await governance();
  const collected = await collectMessages(
    gov.securityCouncil.members,
    FREEZE_ACTIONS,
    gov.securityCouncil.domain
  );
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
  return { requests, errors: collected.errors, anomalies: collected.anomalies, governance: gov };
}

export type FreezeDetail = {
  params: FreezeParams;
  set: SignatureSet;
  state: SetState;
  execution: ExecutionView | null;
  governance: Governance;
};

/** The strict result (JSON). */
export function getFreezeRequest(
  params: FreezeParams,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
): Promise<FreezeDetail> {
  return loadFreezeRequest(params, { supplied }).fresh;
}

/**
 * The request's signatures: `fresh` is the strict result; with `freshness: "page"`, `first` is the
 * page's first answer (a labelled stale set without an execution, or the strict result, see
 * firstSignatureSet). Otherwise `first` is `fresh`.
 */
export function loadFreezeRequest(
  params: FreezeParams,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
): { first: Promise<FreezeDetail>; fresh: Promise<FreezeDetail> } {
  const started = governance().then((gov) => {
    const message: Record<string, string> = { nonce: params.nonce, validUntil: params.validUntil };
    if (params.action === "SetSoftFreezeThreshold") message.threshold = params.threshold ?? "0";
    const state = freezeState(gov, params);
    const streamed = streamSignatureSet(
      {
        action: params.action,
        signerGroup: "securityCouncil",
        typedData: buildTypedData(params.action, gov.securityCouncil.domain, message),
        members: gov.securityCouncil.members,
        threshold: thresholdFor(gov, params.action),
        check: { kind: "multisig", contract: gov.securityCouncil.address },
        supplied,
        open: state.status === "open",
      },
      freshness
    );
    return { gov, state, streamed };
  });
  const fresh = started.then(async ({ gov, state, streamed }): Promise<FreezeDetail> => {
    const set = await streamed.fresh;
    const execution = await executionFor(set, state, (valid) =>
      freezeExecution(
        params.action,
        gov.securityCouncil.address,
        { validUntil: params.validUntil, threshold: params.threshold },
        valid
      )
    );
    return { params, set, state, execution, governance: gov };
  });
  const first = started.then(({ gov, state, streamed }) =>
    firstOrFresh([streamed], fresh, ([set]) => ({
      params,
      set: set as SignatureSet,
      state,
      execution: null,
      governance: gov,
    }))
  );
  for (const pending of [first, fresh]) void pending.catch(() => {});
  return { first, fresh };
}
