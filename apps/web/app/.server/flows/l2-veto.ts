import { type MemberSignature, cancelL2Execution } from "@/common/execution";
import { buildTypedData } from "@/common/typed-data";
import { type Address, getAddress, isAddressEqual } from "viem";
import { type Governance, governance } from "../governance";
import { type SignatureSet, verifySignatureSet } from "../signatures";
import { type ExecutionView, type SetState, executionFor } from "./common";
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
  if (l2Proposal && l2Proposal.state !== "Pending" && l2Proposal.state !== "Active") {
    return {
      status: "closed",
      detail: `The L2 proposal is ${l2Proposal.state ?? "in an unknown state"}; cancelling it would fail on L2`,
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
    l2Error: vetoable instanceof Error ? vetoable.message : null,
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
  l2Proposal: L2ProposalView | null;
  governorKnown: boolean;
  governance: Governance;
};

export async function getL2Veto(
  params: VetoParams,
  { supplied = [] }: { supplied?: MemberSignature[] } = {}
): Promise<VetoDetail> {
  const gov = await governance();
  const [l2Proposal, governors] = await Promise.all([
    getL2Proposal(params.l2GovernorAddress, BigInt(params.l2ProposalId)).catch(() => null),
    knownGovernors(),
  ]);
  const set = await verifySignatureSet({
    action: "CancelL2GovernorProposal",
    signerGroup: "guardians",
    typedData: buildTypedData("CancelL2GovernorProposal", gov.guardians.domain, { ...params }),
    members: gov.guardians.members,
    threshold: gov.guardians.thresholds.cancelL2Proposal,
    check: { kind: "multisig", contract: gov.guardians.address },
    supplied,
  });
  const state = vetoState(gov, params, l2Proposal);
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
  return {
    params,
    set,
    state,
    execution,
    l2Proposal,
    governorKnown: governors.some(
      (g) => g.kind !== "protocol" && isAddressEqual(g.address, params.l2GovernorAddress)
    ),
    governance: gov,
  };
}
