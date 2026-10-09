import { watchItems, watchKeys } from "@/.server/sync/presence";
import { type UpgradeSummary, listStandardUpgrades } from "@/.server/flows/standard";
import { isUpgradeActive } from "@/common/upgrade-states";
import { HistoryToggle, PendingRegion, useNavigatingTo } from "@/components/history-toggle";
import { EmptyState, PageHeader } from "@/components/page";
import { IndexedLoadingCard } from "@/components/sync-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  // While this run re-reads the handler's history, the page may list from the history the last
  // run saved (labelled), and the list from this run's history follows in the same response.
  const list = listStandardUpgrades({ allHistory, freshness: "page" });
  const freshList = list.then((first) =>
    first.fromLastRun ? listStandardUpgrades({ allHistory }) : null
  );
  void freshList.catch(() => {});
  return defer({
    watch: watchItems(request, [watchKeys.upgrades(allHistory)]),
    allHistory,
    list,
    freshList,
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
            <UntilFresh stale={first.fromLastRun === true} fresh={freshList}>
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
  result: SerializeFrom<Awaited<ReturnType<typeof listStandardUpgrades>>>;
  allHistory: boolean;
  /** For a list from the last run's history: where the verified list is. */
  refresh?: Refresh;
}) {
  const active = result.upgrades.filter((u) => isUpgradeActive(u.state));
  const past = result.upgrades.filter((u) => !isUpgradeActive(u.state));
  const toggle = allHistory ? $path("/app/proposals") : `${$path("/app/proposals")}?history=all`;
  const switching = useNavigatingTo(toggle);
  return (
    <div className="space-y-8">
      {result.fromLastRun && <LastRunNote refresh={refresh} what="The upgrades listed below" />}
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">In progress</h2>
        <PendingRegion pending={switching}>
          {active.length === 0 ? (
            <EmptyState>No upgrade is waiting for approval or execution.</EmptyState>
          ) : (
            <UpgradeRows upgrades={active} testId="active-upgrades" />
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
            <UpgradeRows upgrades={past} testId="finished-upgrades" />
          )}
        </PendingRegion>
      </div>
    </div>
  );
}

function UpgradeRows({
  upgrades,
  testId,
}: { upgrades: SerializeFrom<UpgradeSummary>[]; testId: string }) {
  return (
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
  );
}

function Flag({ label }: { label: string }) {
  return (
    <Badge variant="success">
      <Check /> {label}
    </Badge>
  );
}
