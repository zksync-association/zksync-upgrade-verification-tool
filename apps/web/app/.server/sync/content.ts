import type { EmergencySummary, PendingEmergencies } from "../flows/emergency";
import type { FreezeList } from "../flows/freeze";
import type { L2ProposalView, NotStartedUpgrade } from "../flows/l2";
import type { SignedVetoes, VetoableProposals } from "../flows/l2-veto";
import type { UpgradeList } from "../flows/standard";
import type { AppStatus } from "../status";
import type { UpgradeStatusRead } from "../upgrade-status";
import type { WatchItem } from "./presence";
import { noteContent } from "./revs";

// What each page key's revision is a digest of (sync/revs.ts). A page's loader digests what it
// sends with these functions (loaderRevs), and the sync engine digests what is on screen from
// memory at each served head with the same ones (sync/content-engine.ts), so the two agree
// whenever they show the same thing. Only what a page shows that can change is digested: never a
// label (block numbers, ages), never anything about a supplied signature. Signature sets (`set:`
// keys) are digested where they are verified (signatures.ts setContent).

/** An upgrade's or emergency upgrade's state and status (`upgrade:` and `emergency:` keys). */
export const idContent = ({ state, status }: UpgradeStatusRead) => ({ state, status });

/** The app status the shell shows (`status`): governance but its block, and the trust checks. */
export function statusContent(status: Extract<AppStatus, { ok: true }>) {
  const { latestBlock: _block, ...governance } = status.governance;
  return {
    governance,
    logHistory: status.logHistory.status,
    index: status.sync.index.state,
    l2Index: status.sync.l2Index.state,
    cache: status.sync.cache.state,
  };
}

/** The upgrades list (`list:upgrades[:90|:all]`). */
export const upgradeListContent = (list: Pick<UpgradeList, "upgrades" | "allHistory">) => ({
  allHistory: list.allHistory,
  upgrades: list.upgrades.map((u) => ({
    id: u.id,
    txHash: u.txHash,
    state: u.state,
    createdAt: u.createdAt,
    approvedBySecurityCouncil: u.approvedBySecurityCouncil,
    approvedByGuardians: u.approvedByGuardians,
    legalVetoExtended: u.legalVetoExtended,
  })),
});

/** The emergency upgrades list (`list:emergency[:all]`): pending ids from Safe, executions. */
export const emergencyListContent = (
  pending: Pick<PendingEmergencies, "pending" | "errors" | "anomalies">,
  executed: readonly Pick<EmergencySummary, "id" | "executed">[]
) => ({
  pending: pending.pending.map((p) => ({ id: p.id, reported: p.reported, firstSeen: p.firstSeen })),
  errors: pending.errors,
  anomalies: pending.anomalies,
  executed: executed.map((e) => ({ id: e.id, executed: e.executed })),
});

/** The freeze requests list (`list:freeze`): each request and its state at the head. */
export const freezeListContent = (list: Pick<FreezeList, "requests" | "errors" | "anomalies">) => ({
  requests: list.requests,
  errors: list.errors,
  anomalies: list.anomalies,
});

/** An L2 proposal as pages show it (its state changes; its content does not). */
export const l2ProposalContent = (p: L2ProposalView | null) =>
  p && {
    governor: p.governor,
    proposalId: p.proposalId,
    state: p.state,
    voteStart: p.voteStart,
    voteEnd: p.voteEnd,
    idMatchesLocal: p.idMatchesLocal,
    idMatchesContract: p.idMatchesContract,
  };

/** The veto list (`list:vetoes`): vetoes signed in Safe with their state, vetoable proposals. */
export const vetoListContent = (
  signed: Pick<SignedVetoes, "vetoes" | "errors" | "anomalies">,
  vetoable: Pick<VetoableProposals, "vetoable" | "l2Error">
) => ({
  vetoes: signed.vetoes,
  errors: signed.errors,
  anomalies: signed.anomalies,
  vetoable: vetoable.vetoable.map(l2ProposalContent),
  l2Error: vetoable.l2Error !== null,
});

/** A veto page's L2 proposal (`l2:<governor>:<id>`). */
export const l2Content = (proposal: L2ProposalView | null, l2Error: string | null) => ({
  proposal: l2ProposalContent(proposal),
  l2Error: l2Error !== null,
});

/** The upgrades that can start (`list:startable`). */
export const startableContent = (items: readonly NotStartedUpgrade[]) =>
  items.map((item) =>
    item.ok
      ? { id: item.l2ProposalId, tx: item.executedTx, l1: item.l1ProposalId }
      : { id: item.l2ProposalId, tx: item.executedTx, error: item.error }
  );

/**
 * For the root loader: the app status's revision, once it is read (at the head its governance was
 * read at); none for a status that failed. Never rejects.
 */
export async function statusRevs(status: Promise<AppStatus>): Promise<WatchItem[]> {
  const read = await status.catch(() => null);
  if (!read?.ok) return [];
  return [
    noteContent(
      "status",
      { head: BigInt(read.governance.latestBlock.number) },
      statusContent(read)
    ),
  ];
}

/**
 * For a page loader, called as it starts: the revisions of what it sends (sync/revs.ts), once
 * each item's content is in, noted at the head served as the loader started (its content was read
 * at it or later, so a change noted after it is never missed). An item whose content failed, or
 * resolved to undefined (nothing to digest: a first answer from the last run's history, an Era
 * read that failed), is left out: the page then reports its key without a revision. Never rejects.
 */
export async function loaderRevs(
  items: readonly (readonly [string, Promise<unknown>])[]
): Promise<WatchItem[]> {
  // Loaded here, not at the top: page modules import this one, and run in the browser's tests too.
  const at = await import("../rpc").then(({ latestBlock }) => latestBlock()).catch(() => null);
  if (!at) return [];
  const noted = await Promise.all(
    items.map(async ([key, content]) => {
      const value = await content.catch(() => undefined);
      return value === undefined ? null : noteContent(key, { head: at.number }, value);
    })
  );
  return noted.filter((item): item is WatchItem => item !== null);
}
