import { loaderRevs, vetoListContent } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import type { L2ProposalView } from "@/.server/flows/l2";
import {
  type SignedVetoes,
  type VetoSummary,
  type VetoableProposals,
  loadL2VetoList,
} from "@/.server/flows/l2-veto";
import { vetoPath } from "@/common/veto";
import { WithStatus } from "@/components/governance-context";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type AsOfBlock, AsOfContent } from "@/components/verification/as-of";
import { SetStateBadge } from "@/components/verification/badges";
import { CheckSafeNow } from "@/components/verification/check-safe-now";
import { EraBlockNote, ListFreshnessNote, type Refresh } from "@/components/verification/freshness";
import { LastRunNote } from "@/components/verification/last-run";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatEth, formatTime, relativeTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/l2-cancellations"];

export function loader({ request }: LoaderFunctionArgs) {
  // Each list streams on its own: the vetoes from the Guardians' Safe copies held (labelled when
  // older than 60 s and not kept by the watcher for the screen), the vetoable proposals from the
  // last run's history (labelled); the fresh lists follow in the response. ZKsync Era is read at
  // the Era timer's head (at most a minute old, labelled). After a pause, the signed vetoes as
  // last shown come first, as of their block.
  const shown = lastShown();
  const loading = loadL2VetoList({ freshness: "page" });
  const signed = loading.signed.then((s) => (s.stale ? loading.freshSigned : s));
  // A list as last shown is labelled as one from older Safe copies is (stale, with its block).
  const shownSigned = shown.section(
    `${watchKeys.vetoes}:signed`,
    loading.signed,
    freshAfter(loading.signed, loading.freshSigned, (s) => s.stale),
    // Fed by Safe: after a pause, the current list (from older Safe copies, labelled) replaces
    // the one last shown as soon as it is in, and the fresh one replaces that.
    { current: (s) => !s.stale, label: (s) => ({ ...s, stale: true }), early: true }
  );
  return defer({
    watch: watchItems(request, [watchKeys.vetoes]),
    revs: loaderRevs([
      [
        watchKeys.vetoes,
        Promise.all([signed, loading.freshVetoable]).then(([s, vetoable]) =>
          vetoable.l2Error === null ? vetoListContent(s, vetoable) : undefined
        ),
      ],
    ]),
    signed: shownSigned.first,
    freshSigned: shownSigned.fresh,
    signedAfter: shownSigned.after,
    vetoable: loading.vetoable,
    freshVetoable: freshAfter(loading.vetoable, loading.freshVetoable, (v) => v.fromLastRun),
  });
}

export default function VetoList() {
  const { signed, freshSigned, signedAfter, vetoable, freshVetoable } =
    useLoaderData<typeof loader>();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Guardians" title="Guardian veto">
        {/* The threshold and nonce come from the root status; the lists do not wait for it. */}
        <p className="max-w-3xl text-slate-950">
          <WithStatus fallback="Guardians can cancel a proposal on the ZKsync Era Token or GovOps governor before it executes.">
            {({ governance }) =>
              `${governance.guardians.thresholds.cancelL2Proposal} of ${governance.guardians.members.length} Guardians can cancel a proposal on the ZKsync Era Token or GovOps governor before it executes.`
            }
          </WithStatus>{" "}
          The veto is sent from L1 as an L1 → L2 transaction; its gas parameters and nonce are part
          of what Guardians sign.{" "}
          <WithStatus fallback={null}>
            {({ governance }) => (
              <>
                Next nonce: <span className="mono">{governance.guardians.nonce}</span>.
              </>
            )}
          </WithStatus>
        </p>
      </PageHeader>
      <div className="space-y-8">
        <section className="space-y-3" aria-labelledby="signed-vetoes-heading">
          <h2 id="signed-vetoes-heading" className="text-[22px] leading-7">
            Vetoes signed in Safe
          </h2>
          <Suspense fallback={<LoadingCard label="Collecting vetoes from Guardian Safes…" />}>
            <Await
              resolve={signed}
              errorElement={
                <EmptyState>Signed vetoes could not be checked. Refresh to retry.</EmptyState>
              }
            >
              {(first) => (
                <UntilFresh
                  stale={first.stale}
                  fresh={freshSigned}
                  after={signedAfter}
                  staleOf={(s) => s.stale}
                >
                  {(fresh, refresh) => <SignedList result={fresh ?? first} refresh={refresh} />}
                </UntilFresh>
              )}
            </Await>
          </Suspense>
        </section>
        <section className="space-y-3" aria-labelledby="vetoable-heading">
          <h2 id="vetoable-heading" className="text-[22px] leading-7">
            L2 proposals that can still be vetoed
          </h2>
          <Suspense
            fallback={<LoadingCard label="Reading active proposals from ZKsync Era governors…" />}
          >
            <Await
              resolve={vetoable}
              errorElement={
                <EmptyState>Vetoable proposals could not be read. Refresh to retry.</EmptyState>
              }
            >
              {(first) => (
                <UntilFresh stale={first.fromLastRun} fresh={freshVetoable}>
                  {(fresh, refresh) => (
                    <VetoableList result={fresh ?? first} refresh={fresh ? null : refresh} />
                  )}
                </UntilFresh>
              )}
            </Await>
          </Suspense>
        </section>
      </div>
    </div>
  );
}

function SignedList({
  result,
  refresh,
}: {
  result: SerializeFrom<SignedVetoes> & {
    asOf?: AsOfBlock;
  };
  refresh: Refresh;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ListFreshnessNote
          watchKey="list:vetoes"
          // A list as last shown says the block it was read at, and its Safe copies' age.
          set={result.asOf ? { ...result, verifiedAtBlock: result.asOf.block } : result}
          refresh={refresh}
          what="The vetoes and counts below"
        />
        {!result.stale && <CheckSafeNow watchKey="list:vetoes" />}
      </div>
      {(result.errors.length > 0 || result.anomalies > 0) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          The list may be incomplete. {result.errors.join("; ")}
          {result.anomalies > 0 &&
            ` ${result.anomalies} messages had unexpected hashes and were excluded.`}
        </p>
      )}
      {result.vetoes.length === 0 ? (
        <EmptyState>
          {result.errors.length > 0 || result.anomalies > 0
            ? "No veto was found in the available messages."
            : "No Guardian has signed a veto."}
        </EmptyState>
      ) : (
        <Vetoes vetoes={result.vetoes} asOf={result.asOf} />
      )}
    </div>
  );
}

function VetoableList({
  result,
  refresh,
}: { result: SerializeFrom<VetoableProposals>; refresh: Refresh }) {
  return (
    <div className="space-y-3">
      {result.fromLastRun && <LastRunNote refresh={refresh} what="The proposals listed below" />}
      {!result.fromLastRun && !result.l2Error && (
        <EraBlockNote watchKey="list:vetoes" fallback={result.eraHead ?? null} />
      )}
      {result.l2Error ? (
        <EmptyState>
          <span className="block text-amber-900" data-testid="vetoable-unavailable">
            Vetoable proposals could not be read, which does not mean there are none.
          </span>
          <span className="block text-amber-800 text-sm">ZKsync Era RPC: {result.l2Error}</span>
        </EmptyState>
      ) : result.vetoable.length === 0 ? (
        <EmptyState>No Token or GovOps governor proposal is pending or active.</EmptyState>
      ) : (
        <Vetoable proposals={result.vetoable} />
      )}
    </div>
  );
}

function Vetoes({ vetoes, asOf }: { vetoes: SerializeFrom<VetoSummary>[]; asOf?: AsOfBlock }) {
  return (
    <AsOfContent asOf={asOf}>
      <Card className="divide-y divide-slate-100 overflow-hidden" data-testid="vetoes">
        {vetoes.map((v) => (
          <Link
            key={v.digest}
            to={vetoPath(v)}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 hover:bg-slate-25"
            data-testid="veto-row"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-950">
                {v.governorName ?? "Unknown governor"} proposal{" "}
                <span className="mono">{short(v.l2ProposalId)}</span>
              </span>
              <span className="text-slate-600 text-xs">
                Nonce {v.nonce} · mint value {formatEth(v.txMintValue)} · signed in{" "}
                {v.reportedSigners} Safe
                {v.reportedSigners === 1 ? "" : "s"}
              </span>
            </span>
            {!v.governorName && <Badge variant="error">Unknown governor</Badge>}
            <SetStateBadge state={v.state} />
            <ArrowRight className="h-4 w-4 text-slate-600" />
          </Link>
        ))}
      </Card>
    </AsOfContent>
  );
}

function Vetoable({ proposals }: { proposals: SerializeFrom<L2ProposalView>[] }) {
  return (
    <Card className="divide-y divide-slate-100 overflow-hidden" data-testid="vetoable">
      {proposals.map((p) => (
        <div
          key={`${p.governor}-${p.proposalId}`}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-950">
              {p.description.split("\n")[0] || "(no description)"}
            </span>
            <span className="text-slate-600 text-xs">
              {p.governorName} · {p.state ?? "state unknown"} · voting ends {formatTime(p.voteEnd)}
              <WithStatus fallback={null}>
                {({ governance }) =>
                  ` (${relativeTime(p.voteEnd, governance.latestBlock.timestamp)})`
                }
              </WithStatus>
            </span>
          </span>
          <Button variant="secondary" size="sm" asChild>
            <Link
              to={`${$path("/app/l2-cancellations/new")}?governor=${p.governor}&proposalId=${p.proposalId}`}
            >
              Prepare veto
            </Link>
          </Button>
        </div>
      ))}
    </Card>
  );
}

function short(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}
