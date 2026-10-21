import { loaderRevs, upgradeListContent } from "@/.server/sync/content";
import { lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { type UpgradeSummary, listStandardUpgrades, upgradeTitles } from "@/.server/flows/standard";
import { isUpgradeActive } from "@/common/upgrade-states";
import {
  UPGRADE_WINDOWS,
  UPGRADE_WINDOW_LABELS,
  type UpgradeWindow,
  upgradeWindow,
} from "@/common/upgrade-window";
import { PendingRegion } from "@/components/history-toggle";
import { EmptyState, PageHeader } from "@/components/page";
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
import { Await, Link, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { ArrowRight, Check, CheckCircle2, Loader2 } from "lucide-react";
import { Suspense, createContext, useContext } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/proposals"];

export function loader({ request }: LoaderFunctionArgs) {
  const range = upgradeWindow(new URL(request.url).searchParams.get("history"));
  const allHistory = range === "all";
  const days = range === "90" ? 90n : undefined;
  // After a pause, the list as last shown comes first, as of its block.
  const shown = lastShown();
  // While this run re-reads the handler's history, the page may list from the history the last
  // run saved (labelled), and the list from this run's history follows in the same response.
  const list = listStandardUpgrades({ allHistory, days, freshness: "page" });
  const freshList = list.then((first) =>
    first.fromLastRun ? listStandardUpgrades({ allHistory, days }) : null
  );
  void freshList.catch(() => {});
  const shownList = shown.section(watchKeys.upgrades(range), list, freshList, {
    current: (l) => !l.fromLastRun,
  });
  // The titles follow the list: it never waits for them.
  const titles = list.then(upgradeTitles);
  void titles.catch(() => {});
  return defer({
    watch: watchItems(request, [watchKeys.upgrades(range)]),
    revs: loaderRevs([
      [
        watchKeys.upgrades(range),
        Promise.all([list, freshList]).then(([first, fresh]) => upgradeListContent(fresh ?? first)),
      ],
    ]),
    range,
    list: shownList.first,
    freshList: shownList.fresh,
    titles,
  });
}

// Each row's title, from the upgrade's L2 proposal: read after the list, never holding it back.
const Titles = createContext<Promise<Record<string, string | null>> | null>(null);

export default function Upgrades() {
  const { list, freshList, range, titles } = useLoaderData<typeof loader>();
  return (
    <Titles.Provider value={titles}>
      <div>
        <PageHeader
          eyebrow="Standard governance"
          title="Protocol upgrades"
          actions={
            // A little below the title, beside the description (not on a phone, where it wraps).
            <Button asChild className="sm:-mb-3">
              <Link to={$path("/app/proposals/new")}>Start upgrade</Link>
            </Button>
          }
        >
          <p className="text-[14px] text-slate-550">
            Upgrades voted on ZKsync Era and started on L1, and where each stands.
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
                    range={range}
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

const windowPath = (w: UpgradeWindow) =>
  w === "45" ? $path("/app/proposals") : `${$path("/app/proposals")}?history=${w}`;

function UpgradeTable({
  result,
  range,
  refresh = null,
}: {
  result: SerializeFrom<Awaited<ReturnType<typeof listStandardUpgrades>>> & {
    asOf?: AsOfBlock;
  };
  range: UpgradeWindow;
  refresh?: Refresh;
}) {
  const active = result.upgrades.filter((u) => isUpgradeActive(u.state));
  const past = result.upgrades.filter((u) => !isUpgradeActive(u.state));
  const switching = useSwitchingWindow();
  // The list as the beats name it: one not read again at the head served now is shown as of its
  // block, in no colour.
  const watchKey = range === "45" ? "list:upgrades" : `list:upgrades:${range}`;
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
      {active.length === 0 ? (
        // Nothing in progress: one line, not a section.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="no-active">
          <h2 className="font-semibold text-lg">In progress</h2>
          <span className="inline-flex items-center gap-1.5 text-[14px] text-green-900">
            <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" />
            No active upgrades
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">In progress</h2>
          <PendingRegion pending={switching}>
            <UpgradeRows
              upgrades={active}
              testId="active-upgrades"
              asOf={result.asOf}
              stale={stale}
            />
          </PendingRegion>
        </div>
      )}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="font-semibold text-lg">Completed upgrades</h2>
          <WindowSelect range={range} since={result.fromBlock} />
        </div>
        <PendingRegion pending={switching}>
          {past.length === 0 ? (
            <p className="text-[14px] text-slate-600" data-testid="no-completed">
              No completed upgrades in this range.
            </p>
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

// Loading another window: the list stays (dimmed) until it is in.
function useSwitchingWindow(): boolean {
  const navigation = useNavigation();
  return navigation.state !== "idle" && navigation.location.pathname === $path("/app/proposals");
}

/** Last 45 days / Last 90 days / All time: the completed upgrades shown. */
function WindowSelect({ range, since }: { range: UpgradeWindow; since: string }) {
  const navigate = useNavigate();
  const pending = useSwitchingWindow();
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-slate-600">
      {pending && (
        <Loader2 aria-label="Loading" className="h-4 w-4 text-slate-500 motion-safe:animate-spin" />
      )}
      <span className="sr-only">Time range</span>
      <select
        value={range}
        onChange={(e) => navigate(windowPath(upgradeWindow(e.target.value)))}
        title={`Upgrades started since block #${formatNumber(since)}`}
        className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 pr-8 font-medium text-[13px] text-slate-800 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600/20"
        data-testid="upgrade-window"
      >
        {UPGRADE_WINDOWS.map((w) => (
          <option key={w} value={w}>
            {UPGRADE_WINDOW_LABELS[w]}
          </option>
        ))}
      </select>
    </label>
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
