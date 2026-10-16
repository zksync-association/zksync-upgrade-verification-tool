import { freezeListContent, loaderRevs } from "@/.server/sync/content";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { freshAfter } from "@/.server/flows/common";
import { type FreezeList, type FreezeSummary, loadFreezeList } from "@/.server/flows/freeze";
import type { FreezeAction } from "@/common/execution";
import { FREEZE_ACTIONS, FREEZE_LABELS, freezePath } from "@/common/freeze";
import { FREEZE_STATUS_LABELS } from "@/common/upgrade-states";
import { WithStatus, useStatus } from "@/components/governance-context";
import { EmptyState, Facts, LoadingCard, PageHeader, QuietEmpty } from "@/components/page";
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
import { CheckSafeNow } from "@/components/verification/check-safe-now";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import { ListFreshnessNote, type Refresh } from "@/components/verification/freshness";
import { UntilFresh } from "@/components/verification/until-fresh";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, type SerializeFrom, defer } from "@remix-run/node";
import { Await, Link, useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowRight, Plus } from "lucide-react";
import { Suspense, useState } from "react";

export const meta = Meta["/app/freeze"];

export function loader({ request }: LoaderFunctionArgs) {
  // Requests come from Security Council members' Safe messages: the page lists them at once from
  // the copies held (labelled with their age when older than 60 s, and not kept by the watcher
  // for the screen) and the fresh list after it.
  const loading = loadFreezeList({ freshness: "page" });
  const current = loading.first.then((list) => (list.stale ? loading.fresh : list));
  return defer({
    watch: watchItems(request, [watchKeys.freezes]),
    revs: loaderRevs([[watchKeys.freezes, current.then(freezeListContent)]]),
    list: loading.first,
    freshList: freshAfter(loading.first, loading.fresh, (list) => list.stale),
  });
}

export default function FreezeListPage() {
  const { list, freshList } = useLoaderData<typeof loader>();
  // The header and the list's section render at once; the thresholds, nonces and freeze state
  // come from the root status, and fill in when it is read.
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security Council"
        title="Freeze requests"
        actions={
          <WithStatus
            fallback={
              <Button disabled data-testid="new-freeze">
                <Plus /> New request
              </Button>
            }
          >
            {() => <NewRequestDialog />}
          </WithStatus>
        }
      >
        <p className="max-w-[600px] text-[14px] text-slate-550">
          <WithStatus fallback="A soft freeze, a hard freeze, an unfreeze and changing the soft-freeze threshold each need their own number of Security Council signatures.">
            {({ governance: { securityCouncil: sc } }) =>
              `A soft freeze needs ${sc.thresholds.softFreeze} Security Council signatures, a hard freeze ${sc.thresholds.hardFreeze}, an unfreeze ${sc.thresholds.unfreeze}, and changing the soft-freeze threshold ${sc.thresholds.softFreezeConservative}.`
            }
          </WithStatus>{" "}
          Each request is signed for the contract's next nonce and expires at its deadline.
        </p>
      </PageHeader>
      <WithStatus fallback={<ProtocolFacts />}>
        {({ governance }) => <ProtocolFacts governance={governance} />}
      </WithStatus>
      <Suspense
        fallback={<LoadingCard label="Collecting freeze requests from Security Council Safes…" />}
      >
        <Await
          resolve={list}
          errorElement={
            <EmptyState>Freeze requests could not be checked. Refresh to retry.</EmptyState>
          }
        >
          {(first) => (
            <UntilFresh stale={first.stale} fresh={freshList}>
              {(fresh, refresh) => (
                <Requests result={fresh ?? first} refresh={fresh ? null : refresh} />
              )}
            </UntilFresh>
          )}
        </Await>
      </Suspense>
    </div>
  );
}

function ProtocolFacts({
  governance,
}: { governance?: ReturnType<typeof useStatus>["governance"] }) {
  const reading = (
    <span role="status" className="text-slate-600">
      Reading…
    </span>
  );
  const sc = governance?.securityCouncil;
  const frozenUntil = Number(governance?.freeze.protocolFrozenUntil ?? 0);
  return (
    <Facts
      items={[
        {
          label: "Protocol",
          value: !governance
            ? reading
            : frozenUntil > Number(governance.latestBlock.timestamp)
              ? `Frozen until ${formatTime(frozenUntil)}`
              : FREEZE_STATUS_LABELS[governance.freeze.lastFreezeStatus] ?? "Unknown",
        },
        {
          label: "Next nonces (soft · hard · unfreeze · threshold)",
          value: !sc ? (
            reading
          ) : (
            <span className="mono">
              {sc.nonces.softFreeze} · {sc.nonces.hardFreeze} · {sc.nonces.unfreeze} ·{" "}
              {sc.nonces.setSoftFreezeThreshold}
            </span>
          ),
        },
      ]}
    />
  );
}

function Requests({ result, refresh }: { result: SerializeFrom<FreezeList>; refresh: Refresh }) {
  const open = result.requests.filter((r) => r.state.status === "open");
  const rest = result.requests.filter((r) => r.state.status !== "open");
  // The list as the beats name it: one not read again at the head served now is shown as of its
  // block, in no colour.
  const stale = useContentCurrency(result.stale ? null : "list:freeze").behind !== null;
  return (
    <div className="space-y-5">
      {!result.stale && (
        <NotReReadNote watchKey="list:freeze" what="The requests and their states below" />
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ListFreshnessNote
          watchKey="list:freeze"
          set={result}
          refresh={refresh}
          what="The requests and counts below"
        />
        {!result.stale && <CheckSafeNow watchKey="list:freeze" />}
      </div>
      {(result.errors.length > 0 || result.anomalies > 0) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          The list may be incomplete. {result.errors.join("; ")}
          {result.anomalies > 0 &&
            ` ${result.anomalies} messages had unexpected hashes and were excluded.`}
        </p>
      )}
      <div className="space-y-3">
        <h2 className="font-semibold text-lg">Open</h2>
        {open.length === 0 ? (
          <QuietEmpty incomplete={result.errors.length > 0 || result.anomalies > 0}>
            {result.errors.length > 0 || result.anomalies > 0
              ? "No open freeze request was found in the available messages."
              : "No open freeze request."}
          </QuietEmpty>
        ) : (
          <Rows requests={open} testId="open-freezes" stale={stale} />
        )}
      </div>
      {rest.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Past</h2>
          <Rows requests={rest} testId="past-freezes" stale={stale} />
        </div>
      )}
    </div>
  );
}

function Rows({
  requests,
  testId,
  stale = false,
}: {
  requests: SerializeFrom<FreezeSummary>[];
  testId: string;
  /** Not read again at the head served now (content-currency.tsx). */
  stale?: boolean;
}) {
  return (
    <Card
      className={cn("divide-y divide-slate-200 overflow-hidden", stale && "grayscale")}
      data-testid={testId}
      data-stale={stale ? "true" : undefined}
    >
      {requests.map((r) => (
        <Link
          key={r.digest}
          to={freezePath(r)}
          className="group relative flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 transition-colors hover:bg-slate-75 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600 focus-visible:ring-inset"
          data-testid="freeze-row"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-navy-800 group-hover:text-brand-700">
              {FREEZE_LABELS[r.action]}
              {r.action === "SetSoftFreezeThreshold" && ` to ${r.threshold}`} · nonce {r.nonce}
            </span>
            <span className="text-slate-550 text-xs">
              Valid until {formatTime(r.validUntil)}
              <WithStatus fallback={null}>
                {({ governance }) =>
                  ` (${relativeTime(r.validUntil, governance.latestBlock.timestamp)})`
                }
              </WithStatus>{" "}
              · signed in {r.reportedSigners} Safe{r.reportedSigners === 1 ? "" : "s"}
            </span>
          </span>
          <SetStateBadge state={r.state} />
          <ArrowRight
            aria-hidden
            className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700"
          />
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
        <Button data-testid="new-freeze">
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
