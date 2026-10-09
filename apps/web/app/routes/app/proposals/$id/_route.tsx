import { idContent, loaderRevs } from "@/.server/sync/content";
import { heldSet, lastShown, rereadsSafe } from "@/.server/sync/last-shown";
import { pageLoad, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import {
  type ApprovalSet,
  type RecordedApproval,
  type StandardUpgradeCore,
  loadStandardUpgrade,
} from "@/.server/flows/standard";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { AddressLink, ExternalAnchor, Hash, TxLink } from "@/components/hex";
import { Check, EmptyState, Facts, LoadingCard, PageHeader, Section } from "@/components/page";
import { CallList } from "@/components/verification/calls";
import { ExecutionPanel } from "@/components/verification/execution-panel";
import {
  LastRunCheck,
  LastRunText,
  type Provenance,
  provenanceOf,
} from "@/components/verification/last-run";
import { SignatureSetCard } from "@/components/verification/signature-set";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import {
  NotReReadNote,
  PageCurrency,
  useContentCurrency,
} from "@/components/verification/content-currency";
import { UpgradeStateBadge } from "@/components/verification/badges";
import type { Refresh } from "@/components/verification/freshness";
import { Timeline } from "@/components/verification/timeline";
import { UntilFresh } from "@/components/verification/until-fresh";
import { UpgradeFile } from "@/components/verification/upgrade-file";
import { formatNumber, formatTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useAsyncError, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { zeroAddress } from "viem";

export const meta = Meta["/app/proposals/:id"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.id);
  // After a pause, the upgrade as last shown comes first, as of its block.
  const shown = lastShown();
  const supplied = suppliedSignatures(request);
  // Each set's first answer at once (possibly an older block or older Safe copies, labelled), then
  // the strict result in the same response; the sets' keys join the page load's grace.
  const page = pageLoad(request, [watchKeys.upgrade(id)]);
  const loading = page.run(() => loadStandardUpgrade(id, { supplied, freshness: "page" }));
  // Only a start this run's index found is kept: never one from the last run or located directly.
  const detail = shown.section(
    `upgrade:${id.toLowerCase()}`,
    loading.then((d) => d.overview),
    Promise.resolve(null),
    { current: (o) => !o.started.fromLastRun && !o.started.locatedDirectly }
  );
  // Its approvals as last shown, in the first flush too, never waiting on the newest block. Never
  // for a page with a signature from its URL (its sets are verified with it).
  const approvalsKey = `upgrade:${id.toLowerCase()}:approvals`;
  if (supplied.length === 0)
    shown.keep(approvalsKey, shownApprovals(loading), (a) => a.sets.every((s) => !s.set.stale));
  return defer({
    watch: page.watch,
    revs: loaderRevs([[watchKeys.upgrade(id), loading.then((d) => idContent(d.overview))]]),
    id,
    detail: detail.first,
    freshDetail: detail.fresh,
    startedCheck: loading.then((d) => d.startedCheck),
    evidence: loading.then((d) => d.evidence),
    // The approvals as last shown, after a pause (null otherwise): each set as of the block it was
    // verified at, nothing to sign or send from it.
    heldApprovals:
      supplied.length === 0
        ? shown.held<HeldApprovals>(approvalsKey).then((held) => held && heldApprovalsOf(held))
        : Promise.resolve(null),
    // A stale first answer says whether the current one reads Safe again (its copies refreshing).
    sets: loading.then(async (d) =>
      (await d.sets).map((s) =>
        s.set.stale
          ? { ...s, set: { ...s.set, rereadsSafe: rereadsSafe(s.set, s.state.status === "open") } }
          : s
      )
    ),
    freshSets: loading.then((d) =>
      freshAfter(d.sets, d.freshSets, (sets) => sets.some((s) => s.set.stale === true))
    ),
    setEvidence: loading.then((d) => d.setEvidence),
    execution: loading.then((d) => d.execution),
    l2Proposal: loading.then((d) => d.l2Proposal),
  });
}

type HeldApprovals = {
  sets: ApprovalSet[];
  evidence: RecordedApproval[] | null;
};

async function shownApprovals(
  loading: ReturnType<typeof loadStandardUpgrade>
): Promise<HeldApprovals> {
  const d = await loading;
  const [sets, merged, evidence] = await Promise.all([
    d.freshSets,
    d.setEvidence.catch(() => null),
    d.evidence.catch(() => null),
  ]);
  return {
    sets: sets.map((s) => {
      const found = s.state.status === "done" ? merged?.find((e) => e.key === s.key) : undefined;
      // Nothing to send is kept (a held set never offers it).
      return { ...s, ...found, execution: null };
    }),
    evidence,
  };
}

function heldApprovalsOf(held: HeldApprovals & { asOf: { block: string; timestamp: string } }) {
  return {
    ...held,
    sets: held.sets.map((s) => ({ ...s, set: heldSet(s.set, s.state.status === "open") })),
  };
}

export default function UpgradePage() {
  const { id, detail, freshDetail } = useLoaderData<typeof loader>();
  return (
    <div>
      <Suspense
        fallback={
          <>
            <PageHeader
              back={{ to: $path("/app/proposals"), label: "Upgrades" }}
              eyebrow="Protocol upgrade"
              title="Upgrade"
              id={id}
            />
            <LoadingCard label="Reading the proposal status and original calls from L1…" />
          </>
        }
      >
        <Await resolve={detail} errorElement={<DetailError id={id} />}>
          {(first) => (
            <UntilFresh
              stale={first.asOf !== undefined}
              fresh={freshDetail}
              // The current read failed: its own error (not found, an integrity error), as
              // without the upgrade as last shown, never that upgrade with a generic note.
              failed={first.asOf !== undefined ? <DetailError id={id} /> : undefined}
            >
              {(fresh, refresh) => (
                <Detail
                  detail={fresh ?? first}
                  asOf={fresh ? null : first.asOf ?? null}
                  refresh={refresh}
                />
              )}
            </UntilFresh>
          )}
        </Await>
      </Suspense>
    </div>
  );
}

const CALLS_SOURCE: Record<Provenance, { pending: string; failed: string }> = {
  "last-run": {
    pending:
      "Decoded from the UpgradeStarted event in the history saved by the last run (re-verifying; checked against the id above). The handler executes these calls in order when the upgrade runs.",
    failed:
      "Decoded from the UpgradeStarted event in the history saved by the last run, which the chain's current history did not confirm. Do not rely on these calls; reload the page.",
  },
  direct: {
    pending:
      "Decoded from the UpgradeStarted event, located directly from the upgrade's creation time while the history index is verifying (checked against the id above). The handler executes these calls in order when the upgrade runs.",
    failed:
      "Decoded from an UpgradeStarted event located directly, which the handler's complete log history did not confirm. Do not rely on these calls; reload the page.",
  },
};

function DetailError({ id }: { id: string }) {
  const error = useAsyncError() as Error;
  const notFound = error?.message?.includes("no standard upgrade");
  return (
    <>
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title="Upgrade"
        id={id}
      />
      <EmptyState>
        {notFound ? (
          <>
            The ProtocolUpgradeHandler has no standard upgrade with this id.{" "}
            <Link
              className="text-brand-600 hover:underline"
              to={$path("/app/emergency/:id", { id })}
            >
              Open it as an emergency upgrade
            </Link>
            .
          </>
        ) : (
          <span className="text-red-800">{error?.message ?? "Failed to load"}</span>
        )}
      </EmptyState>
    </>
  );
}

function Detail({
  detail: d,
  asOf = null,
  refresh = null,
}: {
  detail: SerializeFrom<StandardUpgradeCore>;
  /**
   * The upgrade as last shown, read at an older block (after a pause): in no colour under a
   * notice, with nothing that waits on the current reads and nothing to act on.
   */
  asOf?: AsOfBlock | null;
  refresh?: Refresh;
}) {
  const {
    sets,
    freshSets,
    evidence,
    setEvidence,
    execution,
    l2Proposal,
    startedCheck,
    heldApprovals,
  } = useLoaderData<typeof loader>();
  // The governance the upgrade was read with: the page never waits on the root status for it.
  const governance = d.governance;
  const provenance = provenanceOf(d.started);
  const labels = {
    [governance.upgradeHandler.toLowerCase()]: "ProtocolUpgradeHandler",
    [governance.securityCouncil.address.toLowerCase()]: "SecurityCouncil",
    [governance.guardians.address.toLowerCase()]: "Guardians",
    [governance.emergencyUpgradeBoard.address.toLowerCase()]: "EmergencyUpgradeBoard",
  };
  const now = Number(governance.latestBlock.timestamp);
  const anyone = d.started.proposal.executor.toLowerCase() === zeroAddress;
  const recorded =
    d.status.securityCouncilApprovalTimestamp !== 0 ||
    d.status.guardiansApproval ||
    d.status.guardiansExtendedLegalVeto;
  // The upgrade's state as the beats name it: one not read again at the head served now is shown
  // as of its block, in no colour, and nothing is signed or sent from the page until it is.
  const watchKey = `upgrade:${d.id.toLowerCase()}`;
  const { behind } = useContentCurrency(asOf ? null : watchKey);
  const stale = behind !== null;

  const page = (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title="Upgrade"
        badges={
          <AsOfContent asOf={asOf} stale={stale} className="inline-flex">
            <UpgradeStateBadge state={d.state} />
          </AsOfContent>
        }
        id={d.id}
      />
      {asOf ? (
        <AsOfNote asOf={asOf} refresh={refresh} what="The state, timeline and calls below" />
      ) : (
        <NotReReadNote watchKey={watchKey} what="The state and timeline below" />
      )}

      <AsOfContent asOf={asOf} stale={stale} className="space-y-10">
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Facts
            items={[
              {
                label: "Started",
                value: (
                  <span className="block space-y-1">
                    <span className="space-x-2">
                      <span>{formatTime(d.status.creationTimestamp)}</span>
                      <TxLink hash={d.started.txHash} />
                    </span>
                    {provenance && <LastRunCheck check={startedCheck} source={provenance} />}
                  </span>
                ),
              },
              {
                label: "Executor",
                value: anyone ? "Anyone" : <AddressLink address={d.started.proposal.executor} />,
              },
              { label: "Salt", value: <Hash value={d.started.proposal.salt} /> },
              {
                label: "L2 vote",
                value: (
                  <Suspense
                    fallback={
                      <span role="status" className="text-slate-600">
                        Finding the L2 vote…
                      </span>
                    }
                  >
                    <Await
                      resolve={l2Proposal}
                      errorElement={
                        <span className="text-slate-600">
                          L2 lookup unavailable. Refresh to retry.
                        </span>
                      }
                    >
                      {(proposal) =>
                        proposal ? (
                          <span className="space-x-2">
                            <span className="mono break-all">
                              ZkProtocolGovernor #{proposal.proposalId}
                            </span>
                            {governance.network.tallyUrl && (
                              <ExternalAnchor
                                href={`${governance.network.tallyUrl}/proposal/${proposal.proposalId}`}
                              >
                                Tally
                              </ExternalAnchor>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-600">Not found on ZKsync Era</span>
                        )
                      }
                    </Await>
                  </Suspense>
                ),
              },
              {
                label: "Content matches the id",
                value: (
                  <Check ok={d.started.idMatches}>
                    keccak256(abi.encode(calls, executor, salt)) {d.started.idMatches ? "=" : "≠"}{" "}
                    id
                  </Check>
                ),
                testId: "id-check",
              },
              {
                label: "Executed",
                value:
                  d.state === UPGRADE_STATES.Done ? (
                    <Suspense
                      fallback={
                        <span role="status" className="text-slate-600">
                          Finding the execution transaction…
                        </span>
                      }
                    >
                      <Await
                        resolve={execution}
                        errorElement={
                          <span className="text-slate-600">
                            Execution transaction unavailable. Refresh to retry.
                          </span>
                        }
                      >
                        {(result) =>
                          result.executedTx ? (
                            <TxLink hash={result.executedTx} />
                          ) : (
                            <span className="text-slate-600">Execution transaction not found</span>
                          )
                        }
                      </Await>
                    </Suspense>
                  ) : (
                    <span className="text-slate-600">Not yet</span>
                  ),
              },
            ]}
          />
          <Timeline
            now={now}
            steps={[
              { label: "Started on L1", at: d.timeline.createdAt, done: true },
              {
                label: d.status.guardiansExtendedLegalVeto
                  ? "Legal veto (extended to 7 days)"
                  : "Legal veto period",
                at: d.timeline.legalVetoEndsAt,
                done: now >= d.timeline.legalVetoEndsAt,
                current: d.state === UPGRADE_STATES.LegalVetoPeriod,
              },
              {
                label: d.timeline.approvedAt
                  ? "Approved by the Security Council"
                  : "Waiting for approval (30 days)",
                at: d.timeline.approvedAt ?? d.timeline.waitingEndsAt,
                done: d.timeline.approvedAt !== null || d.status.guardiansApproval,
                current: d.state === UPGRADE_STATES.Waiting,
                failed: d.state === UPGRADE_STATES.Expired,
              },
              {
                label: "Ready to execute",
                at: d.timeline.readyAt,
                done: d.state === UPGRADE_STATES.Ready || d.state === UPGRADE_STATES.Done,
                current:
                  d.state === UPGRADE_STATES.ExecutionPending || d.state === UPGRADE_STATES.Ready,
              },
              { label: "Executed", at: null, done: d.state === UPGRADE_STATES.Done },
            ]}
          />
        </div>

        <Section
          title={`What the upgrade does · ${d.calls.length} call${d.calls.length === 1 ? "" : "s"}`}
          description={
            // A start from the last run's history, or located directly, says so until this run's
            // history confirms it (the same transaction, block and proposal), then reads as any other.
            <LastRunText
              check={provenance ? startedCheck : null}
              pending={CALLS_SOURCE[provenance ?? "last-run"].pending}
              confirmed="Decoded from the UpgradeStarted event. The handler executes these calls in order when the upgrade runs."
              failed={CALLS_SOURCE[provenance ?? "last-run"].failed}
            />
          }
        >
          <CallList calls={d.calls} labels={labels} />
          {/* Nothing to download from a state as of an older block (held, or not re-read). */}
          {!asOf && !stale && (
            <UpgradeFile proposal={d.started.proposal} name={`upgrade-${d.id.slice(0, 10)}`} />
          )}
        </Section>
      </AsOfContent>

      {asOf ? (
        <Suspense fallback={<ApprovalsPending />}>
          <Await resolve={heldApprovals ?? null} errorElement={<ApprovalsPending />}>
            {(held) =>
              // Only those shown with this upgrade (the same page load): never another block's.
              held && held.asOf.block === asOf.block ? (
                <HeldApprovalsView held={held} asOf={asOf} recorded={recorded} refresh={refresh} />
              ) : (
                <ApprovalsPending />
              )
            }
          </Await>
        </Suspense>
      ) : (
        <>
          {recorded && (
            <Section
              title="Recorded approvals"
              description="Transaction evidence and historical checks load independently of current Safe signatures."
            >
              <Suspense
                fallback={
                  <LoadingCard label="Reading recorded approvals and re-checking their historical signatures…" />
                }
              >
                <Await
                  resolve={evidence}
                  errorElement={
                    <EmptyState>
                      Recorded approval evidence could not be read. Refresh to retry; the proposal's
                      current state is shown above.
                    </EmptyState>
                  }
                >
                  {(records) => <RecordedApprovalList records={records} />}
                </Await>
              </Suspense>
            </Section>
          )}

          <Section
            title="Approvals"
            description="Each member is a Safe. Its signature is looked up in the Safe Transaction Service by the hash this page computes, and counted only if the contract accepts it."
          >
            <Suspense
              fallback={
                <LoadingCard label="Checking current member signatures on-chain… Proposal data above is ready to review." />
              }
            >
              <Await
                resolve={sets}
                errorElement={
                  <EmptyState>
                    Current signatures could not be checked. Proposal data and recorded evidence
                    remain available. Refresh to retry.
                  </EmptyState>
                }
              >
                {(verified) => (
                  <div className="space-y-6">
                    {verified.map((first) => (
                      <UntilFresh
                        key={first.key}
                        stale={first.set.stale === true}
                        fresh={freshSets}
                      >
                        {(fresh, refresh) => {
                          const s = fresh?.find((f) => f.key === first.key) ?? first;
                          const card = (
                            recorded: Pick<typeof s, "state" | "used" | "historical"> = s
                          ) => (
                            <SignatureSetCard
                              testId={`set-${s.key}`}
                              title={s.title}
                              set={s.set}
                              state={recorded.state}
                              execution={s.execution}
                              executionToLabel={
                                s.key === "securityCouncil" ? "SecurityCouncil" : "Guardians"
                              }
                              used={recorded.used}
                              historical={recorded.historical}
                              refresh={s === first ? refresh : null}
                            />
                          );
                          // The recorded evidence is compared with the current result's Safe copies.
                          // The same tree whether or not there is evidence to wait for (an Await of
                          // null renders at once), so a reload that changes that keeps the card (and
                          // what is open in it) mounted.
                          const evidenceFor = s.state.status === "done" && !s.set.stale;
                          return (
                            <Suspense fallback={card()}>
                              <Await
                                resolve={evidenceFor ? setEvidence : null}
                                errorElement={card()}
                              >
                                {(merged) =>
                                  card(
                                    (evidenceFor ? merged?.find((e) => e.key === s.key) : null) ?? s
                                  )
                                }
                              </Await>
                            </Suspense>
                          );
                        }}
                      </UntilFresh>
                    ))}
                  </div>
                )}
              </Await>
            </Suspense>
          </Section>

          {d.state === UPGRADE_STATES.Ready && (
            <Section
              title="Execute the upgrade"
              description="Ready: the handler accepts execute(proposal) from the executor."
            >
              <Suspense fallback={<LoadingCard label="Simulating execution on-chain…" />}>
                <Await
                  resolve={execution}
                  errorElement={
                    <EmptyState>Execution simulation unavailable. Refresh to retry.</EmptyState>
                  }
                >
                  {(result) =>
                    result.execute && (
                      <ExecutionPanel
                        execution={result.execute}
                        toLabel="ProtocolUpgradeHandler"
                        note={
                          anyone
                            ? "Anyone can execute this upgrade."
                            : "Only the executor can execute this upgrade."
                        }
                      />
                    )
                  }
                </Await>
              </Suspense>
            </Section>
          )}
        </>
      )}
    </div>
  );
  return (
    <PageCurrency watchKey={watchKey} what="The upgrade's state">
      {page}
    </PageCurrency>
  );
}

function ApprovalsPending() {
  return <LoadingCard label="Checking the approvals and member signatures at the newest block…" />;
}

function RecordedApprovalList({
  records,
}: {
  records: SerializeFrom<RecordedApproval>[];
}) {
  return (
    <div className="space-y-4" data-testid="recorded-approvals">
      {records.map((record) => (
        <div
          key={record.key}
          className="space-y-2 rounded-xl border border-slate-300 bg-white p-4 sm:p-6"
        >
          <h3 className="font-semibold text-navy-800">{record.title}</h3>
          <p className="text-sm">{record.state.status !== "open" && record.state.detail}</p>
          {record.state.status === "done" && record.state.txHash ? (
            <TxLink hash={record.state.txHash} />
          ) : (
            <p className="text-amber-900 text-sm">The approval transaction could not be located.</p>
          )}
          {record.used && (
            <p className="text-slate-700 text-sm">
              The transaction carried {record.used.signers.length} signatures. Comparison with
              current Safe copies appears below.
            </p>
          )}
          {record.historical ? (
            <p
              className={
                record.historical.accepted === true
                  ? "text-green-900 text-sm"
                  : record.historical.accepted === false
                    ? "text-red-900 text-sm"
                    : "text-slate-700 text-sm"
              }
            >
              {record.historical.accepted === true
                ? `Re-checked at block ${record.historical.block} (just before execution): accepted.`
                : record.historical.accepted === false
                  ? `Re-checked at block ${record.historical.block}: rejected (${record.historical.error}).`
                  : `Not re-checked at block ${record.historical.block}: ${record.historical.error}.`}
            </p>
          ) : (
            <p className="text-amber-900 text-sm">
              Historical signatures could not be reconstructed for a re-check.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The approvals as last shown with the upgrade above (after a pause): in no colour, each set under
 * its own notice naming its block, nothing to sign, fetch or send (a stale set's card offers none).
 */
function HeldApprovalsView({
  held,
  asOf,
  recorded,
  refresh,
}: {
  held: NonNullable<SerializeFrom<Awaited<ReturnType<typeof heldApprovalsOf>>>>;
  asOf: AsOfBlock;
  recorded: boolean;
  refresh: Refresh;
}) {
  return (
    <AsOfContent asOf={asOf} className="space-y-10">
      {recorded && (
        <Section
          title="Recorded approvals"
          description={`As this app last showed them, read at block #${formatNumber(asOf.block)}. The current ones replace them when they arrive.`}
        >
          {held.evidence ? (
            <RecordedApprovalList records={held.evidence} />
          ) : (
            <LoadingCard label="Reading recorded approvals and re-checking their historical signatures…" />
          )}
        </Section>
      )}
      <Section
        title="Approvals"
        description="Each member is a Safe. Its signature is looked up in the Safe Transaction Service by the hash this page computes, and counted only if the contract accepts it."
      >
        <div className="space-y-6">
          {held.sets.map((s) => (
            <SignatureSetCard
              key={s.key}
              testId={`set-${s.key}`}
              title={s.title}
              set={s.set}
              state={s.state}
              execution={null}
              executionToLabel={s.key === "securityCouncil" ? "SecurityCouncil" : "Guardians"}
              used={s.used}
              historical={s.historical}
              refresh={refresh}
            />
          ))}
        </div>
      </Section>
    </AsOfContent>
  );
}
