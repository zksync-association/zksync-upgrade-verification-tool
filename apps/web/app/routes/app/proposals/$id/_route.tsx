import { idContent, loaderRevs } from "@/.server/sync/content";
import { heldSet, lastShown, rereadsSafe } from "@/.server/sync/last-shown";
import { pageLoad, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import {
  type ApprovalSet,
  type StandardUpgradeCore,
  loadStandardUpgrade,
} from "@/.server/flows/standard";
import { parseId } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { UPGRADE_STATES } from "@/common/upgrade-states";
import { AddressLink, CopyButton, Hash, TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader, Section } from "@/components/page";
import { Card } from "@/components/ui/card";
import { CallList } from "@/components/verification/calls";
import { ExecutionPanel } from "@/components/verification/execution-panel";
import {
  LastRunCheck,
  LastRunText,
  type Provenance,
  provenanceOf,
} from "@/components/verification/last-run";
import { ApprovalGroups, SignatureSetCard } from "@/components/verification/signature-set";
import { YourSignature } from "@/components/verification/your-signature";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import {
  NotReReadNote,
  PageCurrency,
  useContentCurrency,
} from "@/components/verification/content-currency";
import { UpgradeStateBadge } from "@/components/verification/badges";
import type { Refresh } from "@/components/verification/freshness";
import { StepTime, Timeline } from "@/components/verification/timeline";
import { upgradeSteps } from "@/components/verification/upgrade-steps";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatTime, relativeTime, shortHex } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useAsyncError, useLoaderData } from "@remix-run/react";
import { type ReactNode, Suspense } from "react";
import { CheckCircle2, ChevronRight, ExternalLink, XCircle } from "lucide-react";
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

type HeldApprovals = { sets: ApprovalSet[] };

async function shownApprovals(
  loading: ReturnType<typeof loadStandardUpgrade>
): Promise<HeldApprovals> {
  const d = await loading;
  const [sets, merged] = await Promise.all([d.freshSets, d.setEvidence.catch(() => null)]);
  return {
    sets: sets.map((s) => {
      const found = s.state.status === "done" ? merged?.find((e) => e.key === s.key) : undefined;
      // Nothing to send is kept (a held set never offers it).
      return { ...s, ...found, execution: null };
    }),
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
  const { sets, freshSets, setEvidence, execution, l2Proposal, startedCheck, heldApprovals } =
    useLoaderData<typeof loader>();
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
  // The upgrade's state as the beats name it: one not read again at the head served now is shown
  // as of its block, in no colour, and nothing is signed or sent from the page until it is.
  const watchKey = `upgrade:${d.id.toLowerCase()}`;
  const { behind } = useContentCurrency(asOf ? null : watchKey);
  const stale = behind !== null;

  const page = (
    <div className="space-y-8">
      <PageHeader
        back={{ to: $path("/app/proposals"), label: "Upgrades" }}
        eyebrow="Protocol upgrade"
        title={<UpgradeTitle l2Proposal={l2Proposal} />}
        badges={
          <AsOfContent asOf={asOf} stale={stale} className="inline-flex">
            <UpgradeStateBadge state={d.state} />
          </AsOfContent>
        }
        id={d.id}
      >
        <UpgradeSummary l2Proposal={l2Proposal} />
      </PageHeader>
      {asOf ? (
        <AsOfNote asOf={asOf} refresh={refresh} what="The state, timeline and calls below" />
      ) : (
        <NotReReadNote watchKey={watchKey} what="The state and timeline below" />
      )}
      {/* What the viewer can sign or send here (never from the upgrade as last shown). */}
      {!asOf && (
        <Suspense fallback={null}>
          <Await resolve={sets} errorElement={null}>
            {(first) => (
              <UntilFresh stale={first.some((s) => s.set.stale === true)} fresh={freshSets}>
                {(fresh) => (
                  <YourSignature
                    hint="Check what the upgrade does below, then compare the hashes in the review with your hardware wallet."
                    actions={(fresh ?? first).map((s) => ({
                      key: s.key,
                      title: s.title,
                      set: s.set,
                      state: s.state,
                      execution: s.execution,
                      executionToLabel:
                        s.key === "securityCouncil" ? "SecurityCouncil" : "Guardians",
                    }))}
                  />
                )}
              </UntilFresh>
            )}
          </Await>
        </Suspense>
      )}

      <AsOfContent asOf={asOf} stale={stale} className="space-y-8">
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="border-slate-200 p-5 sm:p-6" data-testid="upgrade-overview">
            <dl className="grid gap-x-6 gap-y-3.5 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
              <Row label="Started">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <When at={d.status.creationTimestamp} now={now} />
                  <TxLink hash={d.started.txHash} short />
                </span>
                {provenance && <LastRunCheck check={startedCheck} source={provenance} />}
              </Row>
              <Row label="Executor">
                {anyone ? "Anyone" : <AddressLink address={d.started.proposal.executor} />}
              </Row>
              <Row label="L2 vote">
                <Suspense
                  fallback={
                    <span role="status" className="text-slate-500">
                      Finding the L2 vote…
                    </span>
                  }
                >
                  <Await
                    resolve={l2Proposal}
                    errorElement={
                      <span className="text-slate-500">
                        L2 lookup unavailable. Refresh to retry.
                      </span>
                    }
                  >
                    {(proposal) =>
                      proposal ? (
                        <L2Vote id={proposal.proposalId} tallyUrl={governance.network.tallyUrl} />
                      ) : (
                        <span className="text-slate-500">Not found on ZKsync Era</span>
                      )
                    }
                  </Await>
                </Suspense>
              </Row>
              <Row label="Executed">
                {d.state === UPGRADE_STATES.Done ? (
                  <Suspense
                    fallback={
                      <span role="status" className="text-slate-500">
                        Finding the execution transaction…
                      </span>
                    }
                  >
                    <Await
                      resolve={execution}
                      errorElement={
                        <span className="text-slate-500">
                          Execution transaction unavailable. Refresh to retry.
                        </span>
                      }
                    >
                      {(result) =>
                        result.executedTx ? (
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {result.executedAt && <When at={Number(result.executedAt)} now={now} />}
                            <TxLink hash={result.executedTx} short />
                          </span>
                        ) : (
                          <span className="text-slate-500">Execution transaction not found</span>
                        )
                      }
                    </Await>
                  </Suspense>
                ) : (
                  <span className="text-slate-500">Not yet</span>
                )}
              </Row>
              <Row label="Content" testId="id-check">
                {d.started.idMatches ? (
                  <span
                    className="inline-flex items-center gap-1.5 font-medium text-green-800"
                    title="keccak256(abi.encode(calls, executor, salt)) = id"
                  >
                    <CheckCircle2 aria-hidden className="h-4 w-4" /> Upgrade content verified
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 font-semibold text-red-800"
                    title="keccak256(abi.encode(calls, executor, salt)) ≠ id"
                  >
                    <XCircle aria-hidden className="h-4 w-4" /> Content does not match the id
                  </span>
                )}
              </Row>
            </dl>
            <details className="group mt-4 border-slate-100 border-t pt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-[13px] text-slate-600 hover:text-slate-950 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 transition-transform group-open:rotate-90"
                />
                Technical details
              </summary>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
                <Row label="Salt">
                  <Hash value={d.started.proposal.salt} />
                </Row>
                <Row label="Content check">
                  <span className="mono text-[13px] text-slate-800">
                    keccak256(abi.encode(calls, executor, salt)) {d.started.idMatches ? "=" : "≠"}{" "}
                    id
                  </span>
                </Row>
              </dl>
            </details>
          </Card>
          <Timeline
            now={now}
            steps={upgradeSteps({
              state: d.state,
              timeline: d.timeline,
              legalVetoExtended: d.status.guardiansExtendedLegalVeto,
              guardiansApproved: d.status.guardiansApproval,
              now,
              // Its time, once the execution transaction is found.
              executed:
                d.state === UPGRADE_STATES.Done ? (
                  <Suspense fallback={null}>
                    <Await resolve={execution} errorElement={null}>
                      {(result) =>
                        result.executedAt ? (
                          <StepTime at={Number(result.executedAt)} now={now} />
                        ) : null
                      }
                    </Await>
                  </Suspense>
                ) : undefined,
            })}
          />
        </div>

        <CallList
          title="Upgrade actions"
          heading="h2"
          calls={d.calls}
          labels={labels}
          // Said only for a start not confirmed by this run's history yet (or that failed to be).
          note={
            provenance ? (
              <LastRunText
                check={startedCheck}
                pending={CALLS_SOURCE[provenance].pending}
                confirmed="Decoded from the UpgradeStarted event."
                failed={CALLS_SOURCE[provenance].failed}
              />
            ) : undefined
          }
        />
      </AsOfContent>

      {asOf ? (
        <Suspense fallback={<ApprovalsPending />}>
          <Await resolve={heldApprovals ?? null} errorElement={<ApprovalsPending />}>
            {(held) =>
              // Only those shown with this upgrade (the same page load): never another block's.
              held && held.asOf.block === asOf.block ? (
                <HeldApprovalsView held={held} asOf={asOf} refresh={refresh} />
              ) : (
                <ApprovalsPending />
              )
            }
          </Await>
        </Suspense>
      ) : (
        <>
          <Suspense
            fallback={
              <Section title="Approvals">
                <LoadingCard label="Checking current member signatures on-chain… Proposal data above is ready to review." />
              </Section>
            }
          >
            <Await
              resolve={sets}
              errorElement={
                <Section title="Approvals">
                  <EmptyState>
                    Current signatures could not be checked. The proposal above is still shown.
                    Refresh to retry.
                  </EmptyState>
                </Section>
              }
            >
              {(verified) => (
                <ApprovalGroups
                  title="Approvals"
                  heading="h2"
                  count={verified.length}
                  closed={verified.filter((v) => v.state.status === "closed").length}
                >
                  {verified.map((first) => (
                    <UntilFresh key={first.key} stale={first.set.stale === true} fresh={freshSets}>
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
                            <Await resolve={evidenceFor ? setEvidence : null} errorElement={card()}>
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
                </ApprovalGroups>
              )}
            </Await>
          </Suspense>

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

/**
 * The approvals as last shown with the upgrade above (after a pause): in no colour, each set under
 * its own notice naming its block, nothing to sign, fetch or send (a stale set's card offers none).
 */
function HeldApprovalsView({
  held,
  asOf,
  refresh,
}: {
  held: NonNullable<SerializeFrom<Awaited<ReturnType<typeof heldApprovalsOf>>>>;
  asOf: AsOfBlock;
  refresh: Refresh;
}) {
  return (
    <AsOfContent asOf={asOf} className="space-y-8">
      <ApprovalGroups
        title="Approvals"
        heading="h2"
        count={held.sets.length}
        closed={held.sets.filter((s) => s.state.status === "closed").length}
      >
        {held.sets.map((s) => (
          <SignatureSetCard
            key={s.key}
            testId={`set-${s.key}`}
            title={s.title}
            set={s.set}
            state={s.state}
            used={s.used}
            historical={s.historical}
            refresh={refresh}
          />
        ))}
      </ApprovalGroups>
    </AsOfContent>
  );
}

/** The title of the L2 proposal the upgrade came from, once it is found; "Upgrade" until then. */
function UpgradeTitle({ l2Proposal }: { l2Proposal: Promise<{ title: string | null } | null> }) {
  return (
    <Suspense fallback="Upgrade">
      <Await resolve={l2Proposal} errorElement="Upgrade">
        {(proposal) => <span data-testid="upgrade-title">{proposal?.title ?? "Upgrade"}</span>}
      </Await>
    </Suspense>
  );
}

/** What the upgrade changes, from its L2 proposal's summary; nothing until (or unless) found. */
function UpgradeSummary({
  l2Proposal,
}: { l2Proposal: Promise<{ summary?: string | null } | null> }) {
  return (
    <Suspense fallback={null}>
      <Await resolve={l2Proposal} errorElement={null}>
        {(proposal) =>
          proposal?.summary ? (
            <p
              className="max-w-3xl pt-1 text-[15px] text-slate-700 leading-6"
              data-testid="upgrade-summary"
            >
              {proposal.summary}
            </p>
          ) : null
        }
      </Await>
    </Suspense>
  );
}

/** A label and its value in the overview's two columns. */
function Row({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    // On a phone the label sits over its value; from sm up both take the grid's two columns.
    <div className="space-y-0.5 sm:contents" data-testid={testId}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-950">{children}</dd>
    </div>
  );
}

/** A date in view, how long ago on hover. */
function When({ at, now }: { at: number; now: number }) {
  return <span title={relativeTime(at, now)}>{formatTime(at)}</span>;
}

/**
 * The L2 vote: the governor and the proposal number, shortened (the full number on hover and
 * copied), linked to its vote on Tally where the network has one.
 */
function L2Vote({ id, tallyUrl }: { id: string; tallyUrl: string | null }) {
  const short = shortHex(id, 6, 4);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5" title={id}>
      <span className="mono text-[13px] text-slate-800">ZkProtocolGovernor</span>
      {tallyUrl ? (
        <a
          href={`${tallyUrl}/proposal/${id}`}
          target="_blank"
          rel="noreferrer"
          className="mono inline-flex items-center gap-1 text-[13px] text-brand-700 hover:underline"
        >
          #{short}
          <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      ) : (
        <span className="mono text-[13px] text-slate-800">#{short}</span>
      )}
      <CopyButton value={id} label="Copy proposal number" className="sm:h-7 sm:w-7" />
    </span>
  );
}
