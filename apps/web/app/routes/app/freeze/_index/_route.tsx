import { type FreezeSummary, listFreezeRequests } from "@/.server/flows/freeze";
import type { FreezeAction } from "@/common/execution";
import { FREEZE_ACTIONS, FREEZE_LABELS, freezePath } from "@/common/freeze";
import { FREEZE_STATUS_LABELS } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { EmptyState, Facts, LoadingCard, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetStateBadge } from "@/components/verification/badges";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowRight, Plus } from "lucide-react";
import { Suspense, useState } from "react";

export const meta = Meta["/app/freeze"];

export function loader() {
  return defer({ list: listFreezeRequests() });
}

export default function FreezeList() {
  const { list } = useLoaderData<typeof loader>();
  const { governance } = useStatus();
  const sc = governance.securityCouncil;
  const frozenUntil = Number(governance.freeze.protocolFrozenUntil);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Security Council" title="Freeze requests" actions={<NewRequestDialog />}>
        <p className="max-w-3xl text-slate-950">
          A soft freeze needs {sc.thresholds.softFreeze} Security Council signatures, a hard freeze{" "}
          {sc.thresholds.hardFreeze}, an unfreeze {sc.thresholds.unfreeze}, and changing the
          soft-freeze threshold {sc.thresholds.softFreezeConservative}. Each request is signed for
          the contract's next nonce and expires at its deadline.
        </p>
      </PageHeader>
      <Facts
        items={[
          {
            label: "Protocol",
            value:
              frozenUntil > Number(governance.latestBlock.timestamp)
                ? `Frozen until ${formatTime(frozenUntil)}`
                : FREEZE_STATUS_LABELS[governance.freeze.lastFreezeStatus] ?? "Unknown",
          },
          {
            label: "Next nonces (soft · hard · unfreeze · threshold)",
            value: (
              <span className="mono">
                {sc.nonces.softFreeze} · {sc.nonces.hardFreeze} · {sc.nonces.unfreeze} ·{" "}
                {sc.nonces.setSoftFreezeThreshold}
              </span>
            ),
          },
        ]}
      />
      <Suspense
        fallback={<LoadingCard label="Collecting freeze requests from Security Council Safes…" />}
      >
        <Await resolve={list}>{(result) => <Requests result={result} />}</Await>
      </Suspense>
    </div>
  );
}

function Requests({
  result,
}: { result: SerializeFrom<Awaited<ReturnType<typeof listFreezeRequests>>> }) {
  const open = result.requests.filter((r) => r.state.status === "open");
  const rest = result.requests.filter((r) => r.state.status !== "open");
  return (
    <div className="space-y-8">
      {result.errors.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Some Safes could not be read: {result.errors.join("; ")}
        </p>
      )}
      <div className="space-y-3">
        <h2 className="text-[22px] leading-7">Open</h2>
        {open.length === 0 ? (
          <EmptyState>No open freeze request.</EmptyState>
        ) : (
          <Rows requests={open} testId="open-freezes" />
        )}
      </div>
      {rest.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[22px] leading-7">Past</h2>
          <Rows requests={rest} testId="past-freezes" />
        </div>
      )}
    </div>
  );
}

function Rows({ requests, testId }: { requests: SerializeFrom<FreezeSummary>[]; testId: string }) {
  const { governance } = useStatus();
  return (
    <Card className="divide-y divide-slate-100 overflow-hidden" data-testid={testId}>
      {requests.map((r) => (
        <Link
          key={r.digest}
          to={freezePath(r)}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 hover:bg-slate-25"
          data-testid="freeze-row"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-slate-950">
              {FREEZE_LABELS[r.action]}
              {r.action === "SetSoftFreezeThreshold" && ` to ${r.threshold}`} · nonce {r.nonce}
            </span>
            <span className="text-slate-600 text-xs">
              Valid until {formatTime(r.validUntil)} (
              {relativeTime(r.validUntil, governance.latestBlock.timestamp)}) · signed in{" "}
              {r.reportedSigners} Safe{r.reportedSigners === 1 ? "" : "s"}
            </span>
          </span>
          <SetStateBadge state={r.state} />
          <ArrowRight className="h-4 w-4 text-slate-600" />
        </Link>
      ))}
    </Card>
  );
}

function NewRequestDialog() {
  const { governance } = useStatus();
  const navigate = useNavigate();
  const [action, setAction] = useState<FreezeAction>("SoftFreeze");
  const [until, setUntil] = useState(() => toLocalInput(Date.now() + 2 * 86_400_000));
  const [threshold, setThreshold] = useState("1");
  const validUntil = Math.floor(new Date(until).getTime() / 1000);
  const nonce = {
    SoftFreeze: governance.securityCouncil.nonces.softFreeze,
    HardFreeze: governance.securityCouncil.nonces.hardFreeze,
    Unfreeze: governance.securityCouncil.nonces.unfreeze,
    SetSoftFreezeThreshold: governance.securityCouncil.nonces.setSoftFreezeThreshold,
  }[action];
  const valid =
    Number.isFinite(validUntil) && validUntil > Number(governance.latestBlock.timestamp);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" data-testid="new-freeze">
          <Plus /> New request
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New freeze request</DialogTitle>
          <DialogDescription>
            Opens the request page for these values. Nothing is created until a member signs it from
            their Safe.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {FREEZE_ACTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(a)}
                  className={cn(
                    "rounded-[10px] border px-3 py-2 text-left text-sm transition-colors",
                    a === action
                      ? "border-brand-600 bg-brand-50 text-brand-600"
                      : "border-slate-200 hover:bg-slate-50"
                  )}
                >
                  {FREEZE_LABELS[a]}
                </button>
              ))}
            </div>
          </div>
          {action === "SetSoftFreezeThreshold" && (
            <div className="space-y-1.5">
              <Label htmlFor="threshold">New soft-freeze threshold</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={governance.securityCouncil.thresholds.softFreezeConservative}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="valid-until">Valid until (your local time)</Label>
            <Input
              id="valid-until"
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="text-slate-600 text-xs">
              {valid ? (
                <>
                  {formatTime(validUntil)} · signed as{" "}
                  <span className="mono">validUntil = {validUntil}</span> · nonce {nonce}
                </>
              ) : (
                "Must be in the future."
              )}
            </p>
          </div>
          <Button
            className="w-full"
            disabled={!valid}
            onClick={() =>
              navigate(freezePath({ action, nonce, validUntil: String(validUntil), threshold }))
            }
          >
            Open request page
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
