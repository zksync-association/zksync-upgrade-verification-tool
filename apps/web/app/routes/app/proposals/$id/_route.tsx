import { idContent, loaderRevs } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { pageLoad, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import { type StandardUpgradeCore, loadStandardUpgrade } from "@/.server/flows/standard";
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
import { UpgradeStateBadge } from "@/components/verification/badges";
import type { Refresh } from "@/components/verification/freshness";
import { Timeline } from "@/components/verification/timeline";
import { UntilFresh } from "@/components/verification/until-fresh";
import { UpgradeFile } from "@/components/verification/upgrade-file";
import { formatTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useAsyncError, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";
import { $path } from "remix-routes";
import { zeroAddress } from "viem";

export const meta = Meta["/app/proposals/:id"];

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseId(params.id);
  // After a pause (no head in memory), the upgrade as this app last showed it comes first, as of
  // its block, until the current one replaces it (sync/last-shown.ts).
  const shown = lastShown();
  // The page shows each set's first answer at once (possibly from an older block or older Safe
  // copies, labelled) and the strict result after it in the same response. Its sets' keys join
  // the page load's grace as they are found.
  const page = pageLoad(request, [watchKeys.upgrade(id)]);
  const loading = page.run(() =>
    loadStandardUpgrade(id, { supplied: suppliedSignatures(request), freshness: "page" })
  );
  // Only a start this run's index found is kept: never one from the last run or located directly.
  const detail = shown.section(
    `upgrade:${id.toLowerCase()}`,
    loading.then((d) => d.overview),
    Promise.resolve(null),
    { current: (o) => !o.started.fromLastRun && !o.started.locatedDirectly }
  );
  return defer({
    watch: page.watch,
    // The upgrade's state and status, for its revision (its sets carry their own).
    revs: loaderRevs([[watchKeys.upgrade(id), loading.then((d) => idContent(d.overview))]]),
    id,
    detail: detail.first,
    freshDetail: detail.fresh,
    // A start found in the history the last run saved, or located directly while this run's
    // index reads the history (labelled), is confirmed against this run's index.
    startedCheck: loading.then((d) => d.startedCheck),
    evidence: loading.then((d) => d.evidence),
    sets: loading.then((d) => d.sets),
    freshSets: loading.then((d) =>
      freshAfter(d.sets, d.freshSets, (sets) => sets.some((s) => s.set.stale === true))
    ),
    setEvidence: loading.then((d) => d.setEvidence),
    execution: loading.then((d) => d.execution),
    l2Proposal: loading.then((d) => d.l2Proposal),
  });
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
            // After a pause, the upgrade as last shown (as of its block) until the current one
            // replaces it.
            <UntilFresh stale={first.asOf !== undefined} fresh={freshDetail}>
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

/** Where the calls came from, while this run's log index has not confirmed their start yet. */
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
   * The upgrade as this app last showed it, read at an older block (after a pause): shown in no
   * colour under a notice, with nothing that waits on the current reads (signatures, recorded
   * approvals, the execution) and nothing to act on, until the current one replaces it.
   */
  asOf?: AsOfBlock | null;
  /** For `asOf`: where the current upgrade is (see UntilFresh). */
  refresh?: Refresh;
}) {
  const { sets, freshSets, evidence, setEvidence, execution, l2Proposal, startedCheck } =
    useLoaderData<typeof loader>();
  // The governance the upgrade was read with (the same reads as the app status): the page
  // never waits on the root status for it.
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

  return (
    <div className="space-y-10">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title="Upgrade"
        badges={
          <AsOfContent asOf={asOf} className="inline-flex">
            <UpgradeStateBadge state={d.state} />
          </AsOfContent>
        }
        id={d.id}
      />
      {asOf && (
        <AsOfNote asOf={asOf} refresh={refresh} what="The state, timeline and calls below" />
      )}

      <AsOfContent asOf={asOf} className="space-y-10">
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
          {!asOf && (
            <UpgradeFile proposal={d.started.proposal} name={`upgrade-${d.id.slice(0, 10)}`} />
          )}
        </Section>
      </AsOfContent>

      {/* What follows waits on the current reads: as of an older block, only its pending state. */}
      {asOf ? (
        <LoadingCard label="Checking the approvals and member signatures at the newest block…" />
      ) : (
        <>
          {(d.status.securityCouncilApprovalTimestamp !== 0 ||
            d.status.guardiansApproval ||
            d.status.guardiansExtendedLegalVeto) && (
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
                  {(records) => (
                    <div className="space-y-4" data-testid="recorded-approvals">
                      {records.map((record) => (
                        <div
                          key={record.key}
                          className="space-y-2 rounded-xl border border-slate-300 bg-white p-4 sm:p-6"
                        >
                          <h3 className="font-semibold text-navy-800">{record.title}</h3>
                          <p className="text-sm">
                            {record.state.status !== "open" && record.state.detail}
                          </p>
                          {record.state.status === "done" && record.state.txHash ? (
                            <TxLink hash={record.state.txHash} />
                          ) : (
                            <p className="text-amber-900 text-sm">
                              The approval transaction could not be located.
                            </p>
                          )}
                          {record.used && (
                            <p className="text-slate-700 text-sm">
                              The transaction carried {record.used.signers.length} signatures.
                              Comparison with current Safe copies appears below.
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
                  )}
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
                      // A stale first answer shows until the strict result streams in.
                      <UntilFresh
                        key={first.key}
                        stale={first.set.stale === true}
                        fresh={freshSets}
                      >
                        {(fresh, refresh) => {
                          const s = fresh?.find((f) => f.key === first.key) ?? first;
                          // A completed set shows its recorded transaction, the signatures it used
                          // and their re-check once those are in; the current signatures do not wait.
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
}
