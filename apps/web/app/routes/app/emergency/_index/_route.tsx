import { type EmergencySummary, listEmergencyUpgrades } from "@/.server/flows/emergency";
import { useStatus } from "@/components/app-shell";
import { TxLink } from "@/components/hex";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDay, formatNumber } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/emergency"];

export function loader() {
  return defer({ list: listEmergencyUpgrades() });
}

export default function EmergencyList() {
  const { list } = useLoaderData<typeof loader>();
  const { governance } = useStatus();
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
          An emergency upgrade runs immediately once {governance.securityCouncil.eip1271Threshold}{" "}
          of {governance.securityCouncil.members.length} Security Council members,{" "}
          {governance.guardians.eip1271Threshold} of {governance.guardians.members.length} Guardians
          and the ZKsync Foundation have signed its id. Members sign only the id: the calls and salt
          come from the proposer, and this app checks them against the id in your browser.
        </p>
      </PageHeader>
      <Suspense
        fallback={<LoadingCard label="Collecting emergency signatures from members' Safes…" />}
      >
        <Await resolve={list}>{(result) => <Lists result={result} />}</Await>
      </Suspense>
    </div>
  );
}

function Lists({
  result,
}: { result: SerializeFrom<Awaited<ReturnType<typeof listEmergencyUpgrades>>> }) {
  return (
    <div className="space-y-8">
      {result.errors.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Some Safes could not be read: {result.errors.join("; ")}
        </p>
      )}
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">Pending</h2>
        {result.pending.length === 0 ? (
          <EmptyState>
            No member has signed an emergency upgrade that is not executed yet.
          </EmptyState>
        ) : (
          <Rows items={result.pending} testId="pending-emergencies" />
        )}
      </div>
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">Executed</h2>
        {result.executed.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <Rows items={result.executed} testId="executed-emergencies" />
        )}
      </div>
    </div>
  );
}

function Rows({ items, testId }: { items: SerializeFrom<EmergencySummary>[]; testId: string }) {
  return (
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
              <Badge>{e.reported.zkFoundation ? "Foundation signed" : "Foundation pending"}</Badge>
            </span>
          )}
          <Link to={$path("/app/emergency/:id", { id: e.id })} aria-label="Open">
            <ArrowRight className="h-4 w-4 text-slate-400" />
          </Link>
        </div>
      ))}
    </Card>
  );
}
