import { type MemberSignature, cancelL2Execution } from "@/common/execution";
import { buildTypedData } from "@/common/typed-data";
import { type Address, getAddress, isAddressEqual } from "viem";
import { scrubText, secretsOf } from "../chain/jsonrpc";
import type { Governance } from "../governance";
import { governanceFor } from "../page-governance";
import { l2, network } from "../rpc";
import type { Freshness, SignatureSet } from "../signatures";
import {
  type ExecutionView,
  type SetState,
  executionFor,
  firstOrFresh,
  streamSignatureSet,
} from "./common";
import {
  type L2ProposalView,
  type VetoableAnswer,
  activeL2ProposalsAnswer,
  getL2ProposalAnswer,
  knownGovernors,
} from "./l2";
import { firstFromHeld } from "./held";
import { type Collected, collectHeldMessages, collectMessages } from "./messages";

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

export type SignedVetoes = {
  vetoes: VetoSummary[];
  errors: string[];
  anomalies: number;
  /** When the oldest Safe listing the vetoes came from was read (ISO time), or null. */
  safeFetchedAt: string | null;
  /** A page's first answer from Safe listings older than 60 s; always false in JSON. */
  stale: boolean;
};

export type VetoableProposals = {
  vetoable: L2ProposalView[];
  /** Why the list could not be read (then `vetoable` is empty and says nothing). null when read. */
  l2Error: string | null;
  /** A page's first answer from the last run's history; always false in JSON. */
  fromLastRun: boolean;
  eraHead?: { number: string; readAt: string } | null;
};

async function signedFrom(gov: Governance, collected: Collected): Promise<SignedVetoes> {
  const governors = await knownGovernors();
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
    errors: collected.errors,
    anomalies: collected.anomalies,
    safeFetchedAt: collected.safeFetchedAt ?? null,
    stale: collected.stale === true,
  };
}

async function vetoableFrom(answer: Promise<VetoableAnswer>): Promise<VetoableProposals> {
  try {
    const { proposals, provisional, eraHead } = await answer;
    return {
      vetoable: proposals,
      l2Error: null,
      fromLastRun: provisional,
      ...(eraHead !== undefined ? { eraHead } : {}),
    };
  } catch (error) {
    return { vetoable: [], l2Error: await l2ErrorText(error), fromLastRun: false };
  }
}

/**
 * `freshSigned` and `freshVetoable` are the strict lists; a page's `signed` and `vetoable` may first
 * be older (`stale`, `fromLastRun`). States are always read at the head.
 */
export function loadL2VetoList({ freshness = "strict" }: { freshness?: Freshness } = {}) {
  const page = freshness === "page";
  const gov = governanceFor(freshness);
  const freshSigned = gov.then(async (g) =>
    signedFrom(
      g,
      await collectMessages(g.guardians.members, ["CancelL2GovernorProposal"], g.guardians.domain, {
        page,
      })
    )
  );
  const signed = page
    ? gov.then((g) =>
        firstFromHeld(
          collectHeldMessages(
            g.guardians.members,
            ["CancelL2GovernorProposal"],
            g.guardians.domain
          ),
          freshSigned,
          (collected) => signedFrom(g, collected)
        )
      )
    : freshSigned;
  // The Guardians that hash each proposal on L1 are named by this answer's governance: a page's
  // own (kept in memory at each head), never JSON's full read.
  const answerGov = () => gov;
  // The first answer may use the last run's history; one that failed there is this run's to give.
  // A page answers at the Era head pages read; JSON at Era's head.
  const firstVetoable = page
    ? activeL2ProposalsAnswer({ provisional: true, gov: answerGov, page }).then(
        (answer) => answer,
        () => activeL2ProposalsAnswer({ gov: answerGov, page })
      )
    : activeL2ProposalsAnswer({ gov: answerGov });
  const vetoable = vetoableFrom(firstVetoable);
  const freshVetoable = vetoable.then((first) =>
    first.fromLastRun ? vetoableFrom(activeL2ProposalsAnswer({ gov: answerGov, page })) : first
  );
  for (const promise of [gov, signed, freshSigned, vetoable, freshVetoable])
    void promise.catch(() => {});
  return { signed, freshSigned, vetoable, freshVetoable, governance: gov };
}

// For the sync engine: the veto list as a page shows it, from held Safe copies (never asking
// Safe); null when a member Safe's copy is not one a page would use as current.
export async function heldVetoList(): Promise<{
  signed: SignedVetoes;
  vetoable: VetoableProposals;
} | null> {
  const gov = await governanceFor("page");
  const collected = await collectHeldMessages(
    gov.guardians.members,
    ["CancelL2GovernorProposal"],
    gov.guardians.domain
  );
  if (!collected || collected.stale) return null;
  const [signed, vetoable] = await Promise.all([
    signedFrom(gov, collected),
    vetoableFrom(activeL2ProposalsAnswer({ gov: async () => gov, page: true })),
  ]);
  return { signed, vetoable };
}

/** The strict lists together (JSON). */
export async function listL2Vetoes() {
  const loading = loadL2VetoList();
  const [gov, signed, { vetoable, l2Error }] = await Promise.all([
    loading.governance,
    loading.freshSigned,
    loading.freshVetoable,
  ]);
  return {
    vetoes: signed.vetoes,
    vetoable,
    l2Error,
    errors: signed.errors,
    anomalies: signed.anomalies,
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
  l2Error: string | null;
  eraHead: { number: string; readAt: string } | null;
  governorKnown: boolean;
  governance: Governance;
};

// `l2Proposal: null` with no error is an answer (the governor has no such proposal); a failed
// read is never reported as one.
async function readL2Proposal(
  params: VetoParams,
  gov: Governance,
  page = false
): Promise<{
  l2Proposal: L2ProposalView | null;
  l2Error: string | null;
  eraHead: VetoDetail["eraHead"];
}> {
  try {
    if (!(await l2()))
      return { l2Proposal: null, l2Error: "No ZKsync Era RPC is configured", eraHead: null };
    const { proposal, eraHead } = await getL2ProposalAnswer(
      params.l2GovernorAddress,
      BigInt(params.l2ProposalId),
      { gov: async () => gov, page }
    );
    return { l2Proposal: proposal, l2Error: null, eraHead };
  } catch (error) {
    return { l2Proposal: null, l2Error: await l2ErrorText(error), eraHead: null };
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

/** With `freshness: "page"`, `first` may be a labelled stale set without an execution. */
export function loadL2Veto(
  params: VetoParams,
  {
    supplied = [],
    freshness = "strict",
  }: { supplied?: MemberSignature[]; freshness?: Freshness } = {}
): { first: Promise<VetoDetail>; fresh: Promise<VetoDetail> } {
  const started = (async () => {
    const gov = await governanceFor(freshness);
    const [{ l2Proposal, l2Error, eraHead }, governors] = await Promise.all([
      readL2Proposal(params, gov, freshness === "page"),
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
      eraHead,
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
    const execution = await executionFor(
      set,
      state,
      (valid) =>
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
          : null,
      { page: freshness === "page" }
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
