import { type UpgradeSummary, listStandardUpgrades } from "@/.server/flows/standard";
import { isUpgradeActive } from "@/common/upgrade-states";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UpgradeStateBadge } from "@/components/verification/badges";
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
  return defer({ allHistory, list: listStandardUpgrades({ allHistory }) });
}

export default function Upgrades() {
  const { list, allHistory } = useLoaderData<typeof loader>();
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
          <LoadingCard label="Reading UpgradeStarted events from the ProtocolUpgradeHandler…" />
        }
      >
        <Await resolve={list}>
          {(result) => <UpgradeTable result={result} allHistory={allHistory} />}
        </Await>
      </Suspense>
    </div>
  );
}

function UpgradeTable({
  result,
  allHistory,
}: {
  result: SerializeFrom<Awaited<ReturnType<typeof listStandardUpgrades>>>;
  allHistory: boolean;
}) {
  const active = result.upgrades.filter((u) => isUpgradeActive(u.state));
  const past = result.upgrades.filter((u) => !isUpgradeActive(u.state));
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">In progress</h2>
        {active.length === 0 ? (
          <EmptyState>No upgrade is waiting for approval or execution.</EmptyState>
        ) : (
          <UpgradeRows upgrades={active} testId="active-upgrades" />
        )}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[22px] leading-7">Finished</h2>
          <p className="text-slate-600 text-sm">
            {result.allHistory
              ? "Since the handler was deployed"
              : `Since block ${formatNumber(result.fromBlock)} (45 days)`}{" "}
            ·{" "}
            {allHistory ? (
              <Link className="text-brand-600 hover:underline" to={$path("/app/proposals")}>
                Show recent only
              </Link>
            ) : (
              <Link
                className="text-brand-600 hover:underline"
                to={`${$path("/app/proposals")}?history=all`}
              >
                Show full history
              </Link>
            )}
          </p>
        </div>
        {past.length === 0 ? (
          <EmptyState>No finished upgrades in this range.</EmptyState>
        ) : (
          <UpgradeRows upgrades={past} testId="finished-upgrades" />
        )}
      </div>
    </div>
  );
}

function UpgradeRows({
  upgrades,
  testId,
}: { upgrades: SerializeFrom<UpgradeSummary>[]; testId: string }) {
  return (
    <Card className="divide-y divide-slate-100 overflow-hidden" data-testid={testId}>
      {upgrades.map((u) => (
        <Link
          key={u.id}
          to={$path("/app/proposals/:id", { id: u.id })}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 transition-colors hover:bg-slate-25"
          data-testid="upgrade-row"
        >
          <span className="min-w-0 flex-1">
            <span className="mono block truncate text-slate-950">{u.id}</span>
            <span className="text-slate-600 text-xs">
              Started {formatDay(u.createdAt)} · block {formatNumber(u.blockNumber)} ·{" "}
              {u.proposal.calls.length} call
              {u.proposal.calls.length === 1 ? "" : "s"}
              {!u.idMatches && (
                <span className="ml-2 font-semibold text-red-700">
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
          <ArrowRight className="h-4 w-4 text-slate-400" />
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
