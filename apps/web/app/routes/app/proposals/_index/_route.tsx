import { loaderRevs, upgradeListContent } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { type UpgradeSummary, listStandardUpgrades } from "@/.server/flows/standard";
import { isUpgradeActive } from "@/common/upgrade-states";
import { HistoryToggle, PendingRegion, useNavigatingTo } from "@/components/history-toggle";
import { EmptyState, PageHeader } from "@/components/page";
import { IndexedLoadingCard } from "@/components/sync-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import { UpgradeStateBadge } from "@/components/verification/badges";
import type { Refresh } from "@/components/verification/freshness";
import { LastRunNote } from "@/components/verification/last-run";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatDay, formatNumber } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight, Check } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/proposals"];

export function loader({ request }: LoaderFunctionArgs) {
  const allHistory = new URL(request.url).searchParams.get("history") === "all";
  // After a pause (no head in memory), the list as this app last showed it comes first, as of its
  // block, until the current one replaces it (sync/last-shown.ts).
  const shown = lastShown();
  // While this run re-reads the handler's history, the page may list from the history the last
  // run saved (labelled), and the list from this run's history follows in the same response.
  const list = listStandardUpgrades({ allHistory, freshness: "page" });
  const freshList = list.then((first) =>
    first.fromLastRun ? listStandardUpgrades({ allHistory }) : null
  );
  void freshList.catch(() => {});
  const shownList = shown.section(watchKeys.upgrades(allHistory), list, freshList, {
    current: (l) => !l.fromLastRun,
  });
  return defer({
    watch: watchItems(request, [watchKeys.upgrades(allHistory)]),
    revs: loaderRevs([
      [
        watchKeys.upgrades(allHistory),
        Promise.all([list, freshList]).then(([first, fresh]) => upgradeListContent(fresh ?? first)),
      ],
    ]),
    allHistory,
    list: shownList.first,
    freshList: shownList.fresh,
  });
}

export default function Upgrades() {
  const { list, freshList, allHistory } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        eyebrow="Standard governance"
        title="Protocol upgrades"
        actions={
          <Button variant="secondary" asChild>
            <Link to={$path("/app/proposals/new")}>Start an upgrade from L2</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-slate-950">
          Each upgrade was voted on ZKsync Era and started on L1 with a proof of the L2 decision. It
          then needs the Security Council (or, after 30 days, the Guardians) to approve before it
          can be executed.
        </p>
      </PageHeader>
      <Suspense
        fallback={
          <IndexedLoadingCard label="Reading UpgradeStarted events from the ProtocolUpgradeHandler…" />
        }
      >
        <Await
          resolve={list}
          errorElement={
            <EmptyState>
              <div className="space-y-3" role="alert" data-testid="upgrades-unavailable">
                <p className="font-semibold text-slate-950">
                  The proposal list could not be loaded.
                </p>
                <p>
                  Check that your L1 RPC is available and supports log history, then retry. An
                  unavailable list does not mean there are no proposals.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button onClick={() => window.location.reload()}>Retry</Button>
                  <Button variant="secondary" asChild>
                    <Link to="/settings">Open settings</Link>
                  </Button>
                </div>
              </div>
            </EmptyState>
          }
        >
          {(first) => (
            <UntilFresh
              stale={first.fromLastRun === true || first.asOf !== undefined}
              fresh={freshList}
            >
              {(fresh, refresh) => (
                <UpgradeTable
                  result={fresh ?? first}
                  allHistory={allHistory}
                  refresh={fresh ? null : refresh}
                />
              )}
            </UntilFresh>
          )}
        </Await>
      </Suspense>
    </div>
  );
}

function UpgradeTable({
  result,
  allHistory,
  refresh = null,
}: {
  result: SerializeFrom<Awaited<ReturnType<typeof listStandardUpgrades>>> & {
    /** The list as this app last showed it, read at an older block (after a pause). */
    asOf?: AsOfBlock;
  };
  allHistory: boolean;
  /** For a list from the last run's history, or as last shown: where the current list is. */
  refresh?: Refresh;
}) {
  const active = result.upgrades.filter((u) => isUpgradeActive(u.state));
  const past = result.upgrades.filter((u) => !isUpgradeActive(u.state));
  const toggle = allHistory ? $path("/app/proposals") : `${$path("/app/proposals")}?history=all`;
  const switching = useNavigatingTo(toggle);
  // The list as the beats name it: one not read again at the head served now is shown as of its
  // block, in no colour.
  const watchKey = allHistory ? "list:upgrades:all" : "list:upgrades";
  const labelled = result.fromLastRun || result.asOf !== undefined;
  const stale = useContentCurrency(labelled ? null : watchKey).behind !== null;
  return (
    <div className="space-y-8">
      {result.fromLastRun && <LastRunNote refresh={refresh} what="The upgrades listed below" />}
      {result.asOf && (
        <AsOfNote
          asOf={result.asOf}
          refresh={refresh}
          what="The upgrades and states listed below"
        />
      )}
      {!labelled && (
        <NotReReadNote watchKey={watchKey} what="The upgrades and states listed below" />
      )}
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">In progress</h2>
        <PendingRegion pending={switching}>
          {active.length === 0 ? (
            <EmptyState>No upgrade is waiting for approval or execution.</EmptyState>
          ) : (
            <UpgradeRows
              upgrades={active}
              testId="active-upgrades"
              asOf={result.asOf}
              stale={stale}
            />
          )}
        </PendingRegion>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[22px] leading-7">Finished</h2>
          <p className="text-slate-600 text-sm">
            {result.allHistory
              ? "Since the handler was deployed"
              : `Since block ${formatNumber(result.fromBlock)} (45 days)`}{" "}
            ·{" "}
            <HistoryToggle
              to={toggle}
              pendingLabel={allHistory ? "Loading recent upgrades…" : "Loading full history…"}
            >
              {allHistory ? "Show recent only" : "Show full history"}
            </HistoryToggle>
          </p>
        </div>
        <PendingRegion pending={switching}>
          {past.length === 0 ? (
            <EmptyState>No finished upgrades in this range.</EmptyState>
          ) : (
            <UpgradeRows
              upgrades={past}
              testId="finished-upgrades"
              asOf={result.asOf}
              stale={stale}
            />
          )}
        </PendingRegion>
      </div>
    </div>
  );
}

function UpgradeRows({
  upgrades,
  testId,
  asOf,
  stale = false,
}: {
  upgrades: SerializeFrom<UpgradeSummary>[];
  testId: string;
  asOf?: AsOfBlock;
  /** Not read again at the head served now (content-currency.tsx). */
  stale?: boolean;
}) {
  return (
    <AsOfContent asOf={asOf} stale={stale}>
      <Card className="divide-y divide-slate-300 overflow-hidden" data-testid={testId}>
        {upgrades.map((u) => (
          <Link
            key={u.id}
            to={$path("/app/proposals/:id", { id: u.id })}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 transition-colors hover:bg-brand-25"
            data-testid="upgrade-row"
          >
            {/* On a phone the id takes the whole row and the badges wrap below it. */}
            <span className="min-w-0 flex-1 basis-full sm:basis-0">
              <span className="mono block break-all font-medium text-navy-800">{u.id}</span>
              <span className="text-slate-600 text-xs">
                Started {formatDay(u.createdAt)} · block {formatNumber(u.blockNumber)} ·{" "}
                {u.proposal.calls.length} call
                {u.proposal.calls.length === 1 ? "" : "s"}
                {!u.idMatches && (
                  <span className="ml-2 font-semibold text-red-800">
                    id does not match its content
                  </span>
                )}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {u.approvedBySecurityCouncil && <Flag label="Security Council" />}
              {u.approvedByGuardians && <Flag label="Guardians" />}
              {u.legalVetoExtended && <Badge variant="navy">Veto extended</Badge>}
            </span>
            <UpgradeStateBadge state={u.state} />
            <ArrowRight className="h-5 w-5 text-brand-700" />
          </Link>
        ))}
      </Card>
    </AsOfContent>
  );
}

function Flag({ label }: { label: string }) {
  return (
    <Badge variant="success">
      <Check /> {label}
    </Badge>
  );
}
