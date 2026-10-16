import { loaderRevs, upgradeListContent } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { type UpgradeSummary, listStandardUpgrades, upgradeTitles } from "@/.server/flows/standard";
import { isUpgradeActive } from "@/common/upgrade-states";
import { HistoryToggle, PendingRegion, useNavigatingTo } from "@/components/history-toggle";
import { EmptyState, PageHeader, QuietEmpty } from "@/components/page";
import { IndexedLoadingCard } from "@/components/sync-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/hex";
import { Card } from "@/components/ui/card";
import { type AsOfBlock, AsOfContent, AsOfNote } from "@/components/verification/as-of";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import { UpgradeStateBadge } from "@/components/verification/badges";
import type { Refresh } from "@/components/verification/freshness";
import { LastRunNote } from "@/components/verification/last-run";
import { UntilFresh } from "@/components/verification/until-fresh";
import { formatDay, formatNumber, shortHex } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight, Check } from "lucide-react";
import { Suspense, createContext, useContext } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/proposals"];

export function loader({ request }: LoaderFunctionArgs) {
  const allHistory = new URL(request.url).searchParams.get("history") === "all";
  // After a pause, the list as last shown comes first, as of its block.
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
  // The titles follow the list: it never waits for them.
  const titles = list.then(upgradeTitles);
  void titles.catch(() => {});
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
    titles,
  });
}

// Each row's title, from the upgrade's L2 proposal: read after the list, never holding it back.
const Titles = createContext<Promise<Record<string, string | null>> | null>(null);

export default function Upgrades() {
  const { list, freshList, allHistory, titles } = useLoaderData<typeof loader>();
  return (
    <Titles.Provider value={titles}>
      <div>
        <PageHeader
          eyebrow="Standard governance"
          title="Protocol upgrades"
          actions={
            <Button asChild>
              <Link to={$path("/app/proposals/new")}>Start an upgrade from L2</Link>
            </Button>
          }
        >
          <p className="max-w-[600px] text-[14px] text-slate-550">
            Each upgrade was voted on ZKsync Era and started on L1 with a proof of the L2 decision.
            It then needs the Security Council (or, after 30 days, the Guardians) to approve before
            it can be executed.
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
    </Titles.Provider>
  );
}

function UpgradeTable({
  result,
  allHistory,
  refresh = null,
}: {
  result: SerializeFrom<Awaited<ReturnType<typeof listStandardUpgrades>>> & {
    asOf?: AsOfBlock;
  };
  allHistory: boolean;
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
    <div className="space-y-5">
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
        <h2 className="font-semibold text-lg">In progress</h2>
        <PendingRegion pending={switching}>
          {active.length === 0 ? (
            <QuietEmpty>No upgrade is waiting for approval or execution.</QuietEmpty>
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
          <h2 className="font-semibold text-lg">Finished</h2>
          <p className="text-[13px] text-slate-550">
            {result.allHistory ? (
              "Since the handler was deployed"
            ) : (
              <span title={`Since block #${formatNumber(result.fromBlock)}`}>Last 45 days</span>
            )}{" "}
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
            <QuietEmpty>No finished upgrades in this range.</QuietEmpty>
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
      <Card className="divide-y divide-slate-200 overflow-hidden" data-testid={testId}>
        {upgrades.map((u) => (
          // The whole row opens the upgrade (its link covers it); the copy button sits above.
          <div
            key={u.id}
            className="group relative flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 transition-colors hover:bg-slate-75 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-brand-600 has-[a:focus-visible]:ring-inset"
            data-testid="upgrade-row"
          >
            {/* On a phone the text takes the whole row and the badges wrap below it. */}
            <span className="min-w-0 flex-1 basis-full sm:basis-0">
              <RowTitle id={u.id} />
              <span className="flex items-center gap-1">
                <Link
                  to={$path("/app/proposals/:id", { id: u.id })}
                  className="mono text-[13px] text-navy-800 after:absolute after:inset-0 focus-visible:outline-none group-hover:text-brand-700"
                  title={u.id}
                >
                  {shortHex(u.id, 10, 8)}
                  <span className="sr-only"> (open the upgrade)</span>
                </Link>
                <CopyButton value={u.id} label="Copy upgrade ID" className="relative z-10" />
              </span>
              <span className="block text-slate-550 text-xs">
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

function RowTitle({ id }: { id: string }) {
  const titles = useContext(Titles);
  if (!titles) return null;
  return (
    <Suspense
      fallback={
        <span className="mb-1 block h-5 w-72 max-w-full animate-pulse rounded bg-slate-100" />
      }
    >
      <Await resolve={titles} errorElement={null}>
        {(all) =>
          all[id] ? (
            <span
              className="block font-semibold text-base text-navy-800"
              data-testid="upgrade-title"
            >
              {all[id]}
            </span>
          ) : null
        }
      </Await>
    </Suspense>
  );
}

// An approval recorded on chain: stated quietly, the state badge beside it carries the colour.
function Flag({ label }: { label: string }) {
  return (
    <Badge className="border-slate-300 bg-white font-medium text-slate-700">
      <Check /> {label}
    </Badge>
  );
}
