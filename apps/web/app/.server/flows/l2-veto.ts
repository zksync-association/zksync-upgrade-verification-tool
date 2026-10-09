import { type MemberSignature, cancelL2Execution } from "@/common/execution";
import { buildTypedData } from "@/common/typed-data";
import { type Address, getAddress, isAddressEqual } from "viem";
import { scrubText, secretsOf } from "../chain/jsonrpc";
import { type Governance, governance } from "../governance";
import { l2, network } from "../rpc";
import type { Freshness, SignatureSet } from "../signatures";
import {
  type ExecutionView,
  type SetState,
  executionFor,
  firstOrFresh,
  streamSignatureSet,
} from "./common";
import { type L2ProposalView, activeL2Proposals, getL2Proposal, knownGovernors } from "./l2";
import { collectMessages } from "./messages";

// A Guardians veto signs the L2 proposal id plus the L1 → L2 transaction parameters and a nonce.
// The proposal's targets/calldatas/description are needed to execute, and come from the L2
// governor's ProposalCreated event, checked against the signed id.

export type VetoParams = {
  l2ProposalId: string;
  l2GovernorAddress: Address;
  l2GasLimit: string;
  l2GasPerPubdataByteLimit: string;
  refundRecipient: Address;
  txMintValue: string;
  nonce: string;
};

export function vetoState(
  gov: Governance,
  params: VetoParams,
  l2Proposal: L2ProposalView | null
): SetState {
  const current = BigInt(gov.guardians.nonce);
  const nonce = BigInt(params.nonce);
  if (nonce < current)
    return {
      status: "done",
      detail: `Nonce ${nonce} was already used (executed or superseded)`,
      txHash: null,
    };
  if (nonce > current)
    return { status: "closed", detail: `Waits for veto nonce ${current} to be used first` };
  // Only a known final state closes the veto: a state the app could not read leaves it open.
  if (l2Proposal?.state && l2Proposal.state !== "Pending" && l2Proposal.state !== "Active") {
    return {
      status: "closed",
      detail: `The L2 proposal is ${l2Proposal.state}; cancelling it would fail on L2`,
    };
  }
  return { status: "open" };
}

export type VetoSummary = VetoParams & {
  digest: string;
  reportedSigners: number;
  firstSeen: string;
  state: SetState;
  governorName: string | null;
};

export async function listL2Vetoes() {
  const gov = await governance();
  const [collected, governors, vetoable] = await Promise.all([
    collectMessages(gov.guardians.members, ["CancelL2GovernorProposal"], gov.guardians.domain),
    knownGovernors(),
    activeL2Proposals().catch((error: Error) => error),
  ]);
  const vetoes: VetoSummary[] = collected.groups.map((group) => {
    const m = group.typedData.message as Record<keyof VetoParams, string>;
    const params: VetoParams = {
      ...m,
      l2GovernorAddress: getAddress(m.l2GovernorAddress),
      refundRecipient: getAddress(m.refundRecipient),
    };
    return {
      ...params,
      digest: group.digest,
      reportedSigners: group.reportedSigners.length,
      firstSeen: group.firstSeen,
      state: vetoState(gov, params, null),
      governorName:
        governors.find((g) => isAddressEqual(g.address, params.l2GovernorAddress))?.name ?? null,
    };
  });
  return {
    vetoes,
    vetoable: vetoable instanceof Error ? [] : vetoable,
    l2Error: vetoable instanceof Error ? await l2ErrorText(vetoable) : null,
    errors: collected.errors,
    anomalies: collected.anomalies,
    governance: gov,
  };
}

export type VetoDetail = {
  params: VetoParams;
  set: SignatureSet;
  state: SetState;
  execution: ExecutionView | null;
  /** null: not found on the governor, or not read (then `l2Error` says why). */
  l2Proposal: L2ProposalView | null;
  /** Why the L2 proposal was not read: no L2 RPC, or the read failed. null when it was read. */
  l2Error: string | null;
  governorKnown: boolean;
  governance: Governance;
};

/**
 * The L2 proposal, or why it could not be read. `l2Proposal: null` with no error is an answer
 * (the governor has no such proposal); a failed read is never reported as one.
 */
async function readL2Proposal(
  params: VetoParams
): Promise<{ l2Proposal: L2ProposalView | null; l2Error: string | null }> {
  try {
    if (!(await l2())) return { l2Proposal: null, l2Error: "No ZKsync Era RPC is configured" };
    const l2Proposal = await getL2Proposal(params.l2GovernorAddress, BigInt(params.l2ProposalId));
    return { l2Proposal, l2Error: null };
  } catch (error) {
    return { l2Proposal: null, l2Error: await l2ErrorText(error) };
  }
}

/** One line of an L2 read error, without any part of the configured RPC URLs. */
async function l2ErrorText(error: unknown): Promise<string> {
  const raw =
    error instanceof Error
      ? (error as { shortMessage?: string }).shortMessage || error.message
      : String(error);
  // Any URL is removed regardless; the configured one's parts (a key) also outside a URL.
  const url = await network().then(
    (net) => net.l2RpcUrl,
    () => null
  );
  return scrubText(raw.replace(/\s*\n\s*/g, " ").trim(), url ? secretsOf(url) : []);
}

/** The strict result (JSON). */
export function getL2Veto(
  params: VetoParams,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
): Promise<VetoDetail> {
  return loadL2Veto(params, { supplied }).fresh;
}

/**
 * The veto's signatures: `fresh` is the strict result; with `freshness: "page"`, `first` is the
 * page's first answer (a labelled stale set without an execution, or the strict result, see
 * firstSignatureSet). Otherwise `first` is `fresh`.
 */
export function loadL2Veto(
  params: VetoParams,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
): { first: Promise<VetoDetail>; fresh: Promise<VetoDetail> } {
  const started = (async () => {
    const gov = await governance();
    const [{ l2Proposal, l2Error }, governors] = await Promise.all([
      readL2Proposal(params),
      knownGovernors(),
    ]);
    const state = vetoState(gov, params, l2Proposal);
    const streamed = streamSignatureSet(
      {
        action: "CancelL2GovernorProposal",
        signerGroup: "guardians",
        typedData: buildTypedData("CancelL2GovernorProposal", gov.guardians.domain, {
          ...params,
        }),
        members: gov.guardians.members,
        threshold: gov.guardians.thresholds.cancelL2Proposal,
        check: { kind: "multisig", contract: gov.guardians.address },
        supplied,
        open: state.status === "open",
      },
      freshness
    );
    const base = {
      params,
      state,
      l2Proposal,
      l2Error,
      governorKnown: governors.some(
        (g) => g.kind !== "protocol" && isAddressEqual(g.address, params.l2GovernorAddress)
      ),
      governance: gov,
    };
    return { gov, base, streamed };
  })();
  const fresh = started.then(async ({ gov, base, streamed }): Promise<VetoDetail> => {
    const set = await streamed.fresh;
    const { l2Proposal, state } = base;
    const execution = await executionFor(set, state, (valid) =>
      l2Proposal?.idMatchesLocal
        ? cancelL2Execution(
            gov.guardians.address,
            l2Proposal,
            {
              to: params.l2GovernorAddress,
              l2GasLimit: params.l2GasLimit,
              l2GasPerPubdataByteLimit: params.l2GasPerPubdataByteLimit,
              refundRecipient: params.refundRecipient,
              txMintValue: params.txMintValue,
            },
            valid
          )
        : null
    );
    return { ...base, set, execution };
  });
  const first = started.then(({ base, streamed }) =>
    firstOrFresh([streamed], fresh, ([set]) => ({
      ...base,
      set: set as SignatureSet,
      execution: null,
    }))
  );
  for (const pending of [first, fresh]) void pending.catch(() => {});
  return { first, fresh };
}
