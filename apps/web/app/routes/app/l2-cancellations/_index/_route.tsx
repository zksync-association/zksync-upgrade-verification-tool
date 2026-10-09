import type { L2ProposalView } from "@/.server/flows/l2";
import { type VetoSummary, listL2Vetoes } from "@/.server/flows/l2-veto";
import { vetoPath } from "@/common/veto";
import { useStatus } from "@/components/app-shell";
import { EmptyState, LoadingCard, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SetStateBadge } from "@/components/verification/badges";
import { formatEth, formatTime, relativeTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { $path } from "remix-routes";

export const meta = Meta["/app/l2-cancellations"];

export function loader() {
  return defer({ list: listL2Vetoes() });
}

export default function VetoList() {
  const { list } = useLoaderData<typeof loader>();
  const { governance } = useStatus();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Guardians" title="Guardian veto">
        <p className="max-w-3xl text-slate-950">
          {governance.guardians.thresholds.cancelL2Proposal} of{" "}
          {governance.guardians.members.length} Guardians can cancel a proposal on the ZKsync Era
          Token or GovOps governor before it executes. The veto is sent from L1 as an L1 → L2
          transaction; its gas parameters and nonce are part of what Guardians sign. Next nonce:{" "}
          <span className="mono">{governance.guardians.nonce}</span>.
        </p>
      </PageHeader>
      <Suspense
        fallback={
          <LoadingCard label="Collecting vetoes from Guardian Safes and active proposals from ZKsync Era…" />
        }
      >
        <Await resolve={list}>{(result) => <Lists result={result} />}</Await>
      </Suspense>
    </div>
  );
}

function Lists({ result }: { result: SerializeFrom<Awaited<ReturnType<typeof listL2Vetoes>>> }) {
  return (
    <div className="space-y-8">
      {result.errors.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Some Safes could not be read: {result.errors.join("; ")}
        </p>
      )}
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">Vetoes signed in Safe</h2>
        {result.vetoes.length === 0 ? (
          <EmptyState>No Guardian has signed a veto.</EmptyState>
        ) : (
          <Vetoes vetoes={result.vetoes} />
        )}
      </div>
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">L2 proposals that can still be vetoed</h2>
        {result.l2Error && (
          <p className="text-amber-800 text-sm">ZKsync Era RPC: {result.l2Error}</p>
        )}
        {result.vetoable.length === 0 ? (
          <EmptyState>No Token or GovOps governor proposal is pending or active.</EmptyState>
        ) : (
          <Vetoable proposals={result.vetoable} />
        )}
      </div>
    </div>
  );
}

function Vetoes({ vetoes }: { vetoes: SerializeFrom<VetoSummary>[] }) {
  return (
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
  );
}

function Vetoable({ proposals }: { proposals: SerializeFrom<L2ProposalView>[] }) {
  const { governance } = useStatus();
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
              {p.governorName} · {p.state ?? "state unknown"} · voting ends {formatTime(p.voteEnd)}{" "}
              ({relativeTime(p.voteEnd, governance.latestBlock.timestamp)})
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
