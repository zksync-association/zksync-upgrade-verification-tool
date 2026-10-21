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
import { CopyButton, TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader, QuietEmpty } from "@/components/page";
import { IndexedLoadingCard } from "@/components/sync-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import {
  PreparedEmergencies,
  useSavedPayloads,
} from "@/components/verification/prepared-emergencies";
import { CheckSafeNow } from "@/components/verification/check-safe-now";
import { ListFreshnessNote, type Refresh } from "@/components/verification/freshness";
import { LastRunNote } from "@/components/verification/last-run";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatDay, formatNumber, formatTime, shortHex } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/emergency"];

export function loader({ request }: LoaderFunctionArgs) {
  const allHistory = new URL(request.url).searchParams.get("history") === "all";
  // After a pause, both lists as last shown come first, as of their block.
  const shown = lastShown();
  // Pending ids come from members' Safe messages: listed at once from the copies held (labelled
  // when older than 60 s and not kept by the watcher for the screen), the fresh list after it.
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
  // Prepared or loaded in this browser (read after hydration): listed before anyone signs.
  const { saved, reread } = useSavedPayloads();
  return (
    <div>
      <PageHeader
        eyebrow="Emergency governance"
        title="Emergency upgrades"
        actions={
          <Button asChild>
            <Link to={$path("/app/emergency/new")}>Prepare an emergency upgrade</Link>
          </Button>
        }
      >
        <p className="max-w-[600px] text-[14px] text-slate-550">
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
      <div className="space-y-5">
        <NotReReadNote watchKey={watchKey} what="The pending ids, counts and executions below" />
        {saved && saved.length > 0 && (
          <section className="space-y-3" aria-labelledby="prepared-emergencies-heading">
            <div className="space-y-1">
              <h2 id="prepared-emergencies-heading" className="font-semibold text-lg">
                Prepared in this browser
              </h2>
              <p className="text-slate-600 text-sm">
                Kept only here and never sent to the server: the calls stay confidential until the
                upgrade is executed. Members sign only the id.
              </p>
            </div>
            {/* Where each stands, from the lists below once they are read. */}
            <Suspense fallback={<PreparedEmergencies saved={saved} onRemoved={reread} />}>
              <Await
                resolve={pending}
                errorElement={<PreparedEmergencies saved={saved} onRemoved={reread} />}
              >
                {(p) => (
                  <Suspense
                    fallback={
                      <PreparedEmergencies saved={saved} onRemoved={reread} pending={p.pending} />
                    }
                  >
                    <Await
                      resolve={executed}
                      errorElement={
                        <PreparedEmergencies saved={saved} onRemoved={reread} pending={p.pending} />
                      }
                    >
                      {(e) => (
                        <PreparedEmergencies
                          saved={saved}
                          onRemoved={reread}
                          pending={p.pending}
                          executed={e.items}
                        />
                      )}
                    </Await>
                  </Suspense>
                )}
              </Await>
            </Suspense>
          </section>
        )}
        <section className="space-y-3" aria-labelledby="pending-emergencies-heading">
          <h2 id="pending-emergencies-heading" className="font-semibold text-lg">
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
            <h2 id="executed-emergencies-heading" className="font-semibold text-lg">
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
                            <QuietEmpty>
                              {allHistory
                                ? "No emergency executions found since deployment."
                                : `No emergency executions in the last ${EMERGENCY_RECENT_DAYS} days.`}
                            </QuietEmpty>
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
    asOf?: AsOfBlock;
  };
  refresh: Refresh;
  allHistory: boolean;
  /** Not read again at the head served now (content-currency.tsx). */
  stale?: boolean;
}) {
  return (
    <div className="space-y-5">
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
          <QuietEmpty incomplete={result.errors.length > 0 || result.anomalies > 0}>
            {result.errors.length > 0 || result.anomalies > 0
              ? "No pending upgrades were found in the available messages."
              : "No pending emergency upgrades were found in members' Safe messages."}
          </QuietEmpty>
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
      <Card className="divide-y divide-slate-200 overflow-hidden" data-testid={testId}>
        {items.map((e) => (
          // The whole row opens the upgrade (its link covers it); the copy button and the
          // transaction link sit above.
          <div
            key={e.id}
            className="group relative flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 transition-colors hover:bg-slate-75 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-brand-600 has-[a:focus-visible]:ring-inset"
            data-testid="emergency-row"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <Link
                  to={$path("/app/emergency/:id", { id: e.id })}
                  className="mono font-medium text-[13px] text-navy-800 after:absolute after:inset-0 focus-visible:outline-none group-hover:text-brand-700"
                  title={e.id}
                >
                  {shortHex(e.id, 10, 8)}
                  <span className="sr-only"> (open the emergency upgrade)</span>
                </Link>
                <CopyButton value={e.id} label="Copy upgrade ID" className="relative z-10" />
              </span>
              <span className="text-slate-550 text-xs">
                {e.executed
                  ? e.executed.timestamp
                    ? `Executed ${formatTime(e.executed.timestamp)} · block ${formatNumber(e.executed.blockNumber)}`
                    : `Executed in block ${formatNumber(e.executed.blockNumber)}`
                  : `First signed in Safe ${formatDay(e.firstSeen)}`}
              </span>
            </span>
            {e.executed ? (
              <TxLink hash={e.executed.txHash} className="relative z-10" />
            ) : (
              <span
                className="relative z-10 flex flex-wrap items-center gap-1.5"
                title="As reported by Safe; open the upgrade to verify each signature on-chain"
              >
                <Badge>Security Council {e.reported.securityCouncil}</Badge>
                <Badge>Guardians {e.reported.guardians}</Badge>
                <Badge>
                  {e.reported.zkFoundation ? "Foundation signed" : "Foundation pending"}
                </Badge>
              </span>
            )}
            <ArrowRight
              aria-hidden
              className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700"
            />
          </div>
        ))}
      </Card>
    </AsOfContent>
  );
}
