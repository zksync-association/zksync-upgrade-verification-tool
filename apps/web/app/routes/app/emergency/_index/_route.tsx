import { emergencyListContent, loaderRevs } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import {
  type EmergencySummary,
  type ExecutedFirst,
  type PendingEmergencies,
  loadEmergencyList,
} from "@/.server/flows/emergency";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import { WithStatus } from "@/components/governance-context";
import { HistoryToggle, PendingRegion, useNavigatingTo } from "@/components/history-toggle";
import { TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { IndexedLoadingCard } from "@/components/sync-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import { CheckSafeNow } from "@/components/verification/check-safe-now";
import { ListFreshnessNote, type Refresh } from "@/components/verification/freshness";
import { LastRunNote } from "@/components/verification/last-run";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatDay, formatNumber } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/emergency"];

export function loader({ request }: LoaderFunctionArgs) {
  const allHistory = new URL(request.url).searchParams.get("history") === "all";
  // After a pause (no head in memory), both lists as this app last showed them come first, as of
  // their block, until the current ones replace them (sync/last-shown.ts).
  const shown = lastShown();
  // Pending ids come from members' Safe messages: the page lists them at once from the copies held
  // (labelled with their age when older than 60 s, and not kept by the watcher for the screen)
  // and the fresh list after it.
  const loading = loadEmergencyList({ allHistory, freshness: "page" });
  const pending = loading.pending.then((p) => (p.stale ? loading.freshPending : p));
  // Executions likewise: from the history the last run saved while this run re-reads it
  // (labelled), and the list from this run's history after it. They need no governance read.
  const key = watchKeys.emergencies(allHistory);
  // A list as last shown is labelled as one from older Safe copies is (stale, with its block).
  const shownPending = shown.section(
    `${key}:pending`,
    loading.pending,
    freshAfter(loading.pending, loading.freshPending, (p) => p.stale),
    // Fed by Safe: after a pause, the current list (from older Safe copies, labelled) replaces
    // the one last shown as soon as it is in, and the fresh one replaces that.
    { current: (p) => !p.stale, label: (p) => ({ ...p, stale: true }), early: true }
  );
  const executed = loading.executedFirst;
  const freshExecuted = executed.then((first) =>
    first.fromLastRun
      ? loading.executed.then((items): ExecutedFirst => ({ items, fromLastRun: false }))
      : null
  );
  void freshExecuted.catch(() => {});
  const shownExecuted = shown.section(`${key}:executed`, executed, freshExecuted, {
    current: (e) => !e.fromLastRun,
  });
  return defer({
    watch: watchItems(request, [key]),
    revs: loaderRevs([
      [
        key,
        Promise.all([pending, loading.executed]).then(([p, executed]) =>
          emergencyListContent(p, executed)
        ),
      ],
    ]),
    allHistory,
    pending: shownPending.first,
    freshPending: shownPending.fresh,
    pendingAfter: shownPending.after,
    executed: shownExecuted.first,
    freshExecuted: shownExecuted.fresh,
  });
}

export default function EmergencyList() {
  const { pending, freshPending, pendingAfter, executed, freshExecuted, allHistory } =
    useLoaderData<typeof loader>();
  const toggle = allHistory ? $path("/app/emergency") : `${$path("/app/emergency")}?history=all`;
  const switching = useNavigatingTo(toggle);
  // The list as the beats name it: one not read again at the head served now is shown as of its
  // block, in no colour.
  const watchKey = allHistory ? "list:emergency:all" : "list:emergency";
  const stale = useContentCurrency(watchKey).behind !== null;
  return (
    <div>
      <PageHeader
        eyebrow="Emergency governance"
        title="Emergency upgrades"
        actions={
          <Button variant="secondary" asChild>
            <Link to={$path("/app/emergency/new")}>Prepare an emergency upgrade</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-slate-950">
          {/* The thresholds come from the root status; the rest of the page does not wait for it. */}
          <WithStatus fallback="An emergency upgrade runs immediately once enough Security Council members, Guardians and the ZKsync Foundation have signed its id.">
            {({ governance }) =>
              `An emergency upgrade runs immediately once ${governance.securityCouncil.eip1271Threshold} of ${governance.securityCouncil.members.length} Security Council members, ${governance.guardians.eip1271Threshold} of ${governance.guardians.members.length} Guardians and the ZKsync Foundation have signed its id.`
            }
          </WithStatus>{" "}
          Members sign only the id: the calls and salt come from the proposer, and this app checks
          them against the id in your browser.
        </p>
      </PageHeader>
      <div className="space-y-8">
        <NotReReadNote watchKey={watchKey} what="The pending ids, counts and executions below" />
        <section className="space-y-3" aria-labelledby="pending-emergencies-heading">
          <h2 id="pending-emergencies-heading" className="text-[22px] leading-7">
            Pending
          </h2>
          <Suspense
            fallback={<LoadingCard label="Collecting emergency signatures from members' Safes…" />}
          >
            <Await
              resolve={pending}
              errorElement={
                <EmptyState>Pending upgrades could not be checked. Refresh to retry.</EmptyState>
              }
            >
              {(first) => (
                <UntilFresh
                  stale={first.stale}
                  fresh={freshPending}
                  after={pendingAfter}
                  staleOf={(p) => p.stale}
                >
                  {(fresh, refresh) => (
                    <PendingList
                      result={fresh ?? first}
                      refresh={refresh}
                      allHistory={allHistory}
                      stale={stale}
                    />
                  )}
                </UntilFresh>
              )}
            </Await>
          </Suspense>
        </section>
        <section className="space-y-3" aria-labelledby="executed-emergencies-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="executed-emergencies-heading" className="text-[22px] leading-7">
              {allHistory
                ? "Executed · full history"
                : `Executed · last ${EMERGENCY_RECENT_DAYS} days`}
            </h2>
            <HistoryToggle
              to={toggle}
              variant="button"
              pendingLabel={allHistory ? "Loading recent executions…" : "Loading full history…"}
            >
              {allHistory ? "Show recent executions" : "Show full history"}
            </HistoryToggle>
          </div>
          <p className="text-slate-600 text-sm">
            {allHistory
              ? "Loading every execution since deployment may take longer on RPCs with small log ranges."
              : "Older executions remain available through full history or by opening their id."}
          </p>
          <Suspense
            fallback={
              <IndexedLoadingCard
                label={
                  allHistory
                    ? "Reading emergency executions since deployment…"
                    : "Reading recent emergency executions…"
                }
              />
            }
          >
            <Await
              resolve={executed}
              errorElement={
                <EmptyState>Execution history could not be read. Refresh to retry.</EmptyState>
              }
            >
              {(first) => (
                <UntilFresh
                  stale={first.fromLastRun || first.asOf !== undefined}
                  fresh={freshExecuted}
                >
                  {(fresh, refresh) => {
                    const items = (fresh ?? first).items;
                    // As this app last showed it (after a pause), until the current list is in.
                    const asOf = fresh ? undefined : first.asOf;
                    return (
                      <PendingRegion pending={switching}>
                        <div className="space-y-3">
                          {!fresh && first.fromLastRun && (
                            <LastRunNote refresh={refresh} what="The executions listed below" />
                          )}
                          {asOf && (
                            <AsOfNote
                              asOf={asOf}
                              refresh={refresh}
                              what="The executions listed below"
                            />
                          )}
                          {items.length ? (
                            <Rows
                              items={items}
                              testId="executed-emergencies"
                              asOf={asOf}
                              stale={stale}
                            />
                          ) : (
                            <EmptyState>
                              {allHistory
                                ? "No emergency executions found since deployment."
                                : `No emergency executions in the last ${EMERGENCY_RECENT_DAYS} days.`}
                            </EmptyState>
                          )}
                        </div>
                      </PendingRegion>
                    );
                  }}
                </UntilFresh>
              )}
            </Await>
          </Suspense>
        </section>
      </div>
    </div>
  );
}

function PendingList({
  result,
  refresh,
  allHistory,
  stale = false,
}: {
  result: SerializeFrom<PendingEmergencies> & {
    /** The list as this app last showed it, read at an older block (after a pause). */
    asOf?: AsOfBlock;
  };
  refresh: Refresh;
  allHistory: boolean;
  /** Not read again at the head served now (content-currency.tsx). */
  stale?: boolean;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ListFreshnessNote
          watchKey={allHistory ? "list:emergency:all" : "list:emergency"}
          // A list as last shown says the block it was read at, and its Safe copies' age.
          set={result.asOf ? { ...result, verifiedAtBlock: result.asOf.block } : result}
          refresh={refresh}
          what="The ids and counts below"
        />
        {!result.stale && (
          <CheckSafeNow watchKey={allHistory ? "list:emergency:all" : "list:emergency"} />
        )}
      </div>
      {(result.errors.length > 0 || result.anomalies > 0) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          The pending list may be incomplete. {result.errors.join("; ")}
          {result.anomalies > 0 &&
            ` ${result.anomalies} messages had unexpected hashes and were excluded.`}
        </p>
      )}
      <div className="space-y-3">
        {result.pending.length === 0 ? (
          <EmptyState>
            {result.errors.length > 0 || result.anomalies > 0
              ? "No pending upgrades were found in the available messages."
              : "No pending emergency upgrades were found in members' Safe messages."}
          </EmptyState>
        ) : (
          <Rows items={result.pending} testId="pending-emergencies" stale={stale} />
        )}
      </div>
    </div>
  );
}

function Rows({
  items,
  testId,
  asOf,
  stale = false,
}: {
  items: SerializeFrom<EmergencySummary>[];
  testId: string;
  asOf?: AsOfBlock;
  stale?: boolean;
}) {
  return (
    <AsOfContent asOf={asOf} stale={stale}>
      <Card className="divide-y divide-slate-100 overflow-hidden" data-testid={testId}>
        {items.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 hover:bg-slate-25"
            data-testid="emergency-row"
          >
            <Link to={$path("/app/emergency/:id", { id: e.id })} className="min-w-0 flex-1">
              <span className="mono block truncate text-slate-950">{e.id}</span>
              <span className="text-slate-600 text-xs">
                {e.executed
                  ? `Executed in block ${formatNumber(e.executed.blockNumber)}`
                  : `First signed in Safe ${formatDay(e.firstSeen)}`}
              </span>
            </Link>
            {e.executed ? (
              <TxLink hash={e.executed.txHash} />
            ) : (
              <span
                className="flex flex-wrap items-center gap-1.5"
                title="As reported by Safe; open the upgrade to verify each signature on-chain"
              >
                <Badge>Security Council {e.reported.securityCouncil}</Badge>
                <Badge>Guardians {e.reported.guardians}</Badge>
                <Badge>
                  {e.reported.zkFoundation ? "Foundation signed" : "Foundation pending"}
                </Badge>
              </span>
            )}
            <Link to={$path("/app/emergency/:id", { id: e.id })} aria-label="Open">
              <ArrowRight className="h-4 w-4 text-slate-600" />
            </Link>
          </div>
        ))}
      </Card>
    </AsOfContent>
  );
}
