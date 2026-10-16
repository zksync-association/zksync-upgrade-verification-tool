import {
  emergencyListContent,
  freezeListContent,
  loaderRevs,
  upgradeListContent,
  vetoListContent,
} from "@/.server/sync/content";
import { type AsOf, lastShown } from "@/.server/sync/last-shown";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import {
  type ExecutedFirst,
  type PendingEmergencies,
  loadEmergencyList,
} from "@/.server/flows/emergency";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import { type FreezeList, loadFreezeList } from "@/.server/flows/freeze";
import { type SignedVetoes, type VetoableProposals, loadL2VetoList } from "@/.server/flows/l2-veto";
import { type UpgradeList, listStandardUpgrades } from "@/.server/flows/standard";
import { network, l1 } from "@/.server/rpc";
import { bytes32Pattern } from "@/.server/request";
import { upgradeHandlerAbi } from "@/common/abis";
import { isUpgradeActive } from "@/common/upgrade-states";
import { Button } from "@/components/ui/button";
import { OverviewSummary, type SummarySource, SummaryNote } from "@/components/overview-summary";
import { notReReadHeadline, useContentCurrency } from "@/components/verification/content-currency";
import { indexingLabel, useIndexProgress } from "@/components/sync-state";
import { UntilFresh } from "@/components/verification/until-fresh";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { Meta } from "@/utils/meta";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  defer,
  json,
  redirect,
} from "@remix-run/node";
import { Await, Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { AlertTriangle, ArrowRight, Ban, Rocket, ShieldAlert, Snowflake } from "lucide-react";
import { type ReactNode, Suspense, useState } from "react";
import { $path } from "remix-routes";
import type { Hex } from "viem";

export const meta = Meta["/"];

// Each count is answered first from what the app holds now (the last run's history, Safe copies
// of any age), labelled with where it came from; the fresh count follows in the same response.

const sourceOf = (
  lastRun: boolean,
  safe: { stale: boolean; safeFetchedAt: string | null } | null
) =>
  lastRun || safe?.stale
    ? { lastRun, safeFetchedAt: safe?.stale ? safe.safeFetchedAt ?? null : null }
    : null;

// Besides the open ones: the requests Safe holds that were executed or can no longer be signed.
function freezeDetail({ open, total }: { open: number; total: number }) {
  const earlier = total - open;
  if (total === 0) return "No requests in Safe";
  if (earlier === 0) return undefined;
  return `${earlier} earlier request${earlier === 1 ? "" : "s"}, no longer open`;
}

const upgradeCount = (r: UpgradeList) => ({
  open: r.upgrades.filter((u) => isUpgradeActive(u.state)).length,
  total: r.upgrades.length,
  source: sourceOf(r.fromLastRun === true, null),
});

const emergencyCount = ([pending, executed]: [PendingEmergencies, ExecutedFirst]) => ({
  pending: pending.pending.length,
  executed: executed.items.length,
  incomplete: pending.errors.length > 0 || pending.anomalies > 0,
  source: sourceOf(executed.fromLastRun, pending),
});

const freezeCount = (r: FreezeList) => ({
  open: r.requests.filter((q) => q.state.status === "open").length,
  total: r.requests.length,
  incomplete: r.errors.length > 0 || r.anomalies > 0,
  source: sourceOf(false, r),
});

const vetoCount = ([signed, vetoable]: [SignedVetoes, VetoableProposals]) => ({
  open: signed.vetoes.filter((v) => v.state.status === "open").length,
  vetoable: vetoable.vetoable.length,
  incomplete: signed.errors.length > 0 || signed.anomalies > 0 || vetoable.l2Error !== null,
  source: sourceOf(vetoable.fromLastRun, signed),
});

function counted<T extends { source: SummarySource }>(first: Promise<T>, fresh: () => Promise<T>) {
  const after = first.then((f) => (f.source ? fresh() : null));
  void after.catch(() => {});
  return { first, fresh: after };
}

/**
 * After a pause, the count as last shown comes first, as of its block, until the current count
 * replaces it. Only a count from fresh sources is kept.
 */
function shownCount<T extends { source: SummarySource }>(
  shown: ReturnType<typeof lastShown>,
  key: string,
  count: { first: Promise<T>; fresh: Promise<T | null> },
  /**
   * Fed by Safe: after a pause, the current count (from older Safe copies, labelled) replaces the
   * one last shown as soon as it is in, and the fresh count replaces that.
   */
  early = false
) {
  return shown.section<T>(`home:${key}`, count.first, count.fresh, {
    current: (c) => c.source === null,
    label: (c, asOf: AsOf): T => ({
      ...c,
      source: { lastRun: false, safeFetchedAt: null, asOfBlock: asOf.block },
    }),
    early,
  });
}

export function loader({ request }: LoaderFunctionArgs) {
  // Before any read starts: whether the page must wait for the newest block.
  const shown = lastShown();
  const upgrades = listStandardUpgrades({ allHistory: false, freshness: "page" });
  const emergency = loadEmergencyList({ freshness: "page" });
  const freeze = loadFreezeList({ freshness: "page" });
  const vetoes = loadL2VetoList({ freshness: "page" });
  const fromSources = {
    upgrades: counted(upgrades.then(upgradeCount), () =>
      listStandardUpgrades({ allHistory: false }).then(upgradeCount)
    ),
    emergency: counted(
      Promise.all([emergency.pending, emergency.executedFirst]).then(emergencyCount),
      () =>
        Promise.all([
          emergency.freshPending,
          emergency.executed.then((items) => ({ items, fromLastRun: false })),
        ]).then(emergencyCount)
    ),
    freeze: counted(freeze.first.then(freezeCount), () => freeze.fresh.then(freezeCount)),
    vetoes: counted(Promise.all([vetoes.signed, vetoes.vetoable]).then(vetoCount), () =>
      Promise.all([vetoes.freshSigned, vetoes.freshVetoable]).then(vetoCount)
    ),
  };
  const counts = {
    upgrades: shownCount(shown, "upgrades", fromSources.upgrades),
    emergency: shownCount(shown, "emergency", fromSources.emergency, true),
    freeze: shownCount(shown, "freeze", fromSources.freeze, true),
    vetoes: shownCount(shown, "vetoes", fromSources.vetoes, true),
  };
  const currentList = upgrades.then((first) =>
    first.fromLastRun ? listStandardUpgrades({ allHistory: false }) : first
  );
  const currentPending = emergency.pending.then((p) => (p.stale ? emergency.freshPending : p));
  const currentFreeze = freeze.first.then((f) => (f.stale ? freeze.fresh : f));
  const currentSigned = vetoes.signed.then((v) => (v.stale ? vetoes.freshSigned : v));
  const revs = loaderRevs([
    [watchKeys.upgrades(false), currentList.then(upgradeListContent)],
    [
      watchKeys.emergencies(false),
      Promise.all([currentPending, emergency.executed]).then(([pending, executed]) =>
        emergencyListContent(pending, executed)
      ),
    ],
    [watchKeys.freezes, currentFreeze.then(freezeListContent)],
    [
      watchKeys.vetoes,
      Promise.all([currentSigned, vetoes.freshVetoable]).then(([signed, vetoable]) =>
        vetoable.l2Error === null ? vetoListContent(signed, vetoable) : undefined
      ),
    ],
  ]);
  return defer({
    watch: watchItems(request, [
      watchKeys.upgrades(false),
      watchKeys.emergencies(false),
      watchKeys.freezes,
      watchKeys.vetoes,
    ]),
    revs,
    upgrades: counts.upgrades.first,
    upgradesFresh: counts.upgrades.fresh,
    emergency: counts.emergency.first,
    emergencyFresh: counts.emergency.fresh,
    emergencyAfter: counts.emergency.after,
    freeze: counts.freeze.first,
    freezeFresh: counts.freeze.fresh,
    freezeAfter: counts.freeze.after,
    vetoes: counts.vetoes.first,
    vetoesFresh: counts.vetoes.fresh,
    vetoesAfter: counts.vetoes.after,
  });
}

// Upgrade and emergency ids are both bytes32; the handler knows which one it is.
export async function action({ request }: ActionFunctionArgs) {
  const id = String((await request.formData()).get("id") ?? "").trim();
  if (!bytes32Pattern.test(id))
    return json({ id, error: "Enter a 32-byte ID: 0x followed by 64 hexadecimal characters." });
  const { upgradeHandler } = await network();
  const status = await l1.readContract({
    address: upgradeHandler,
    abi: upgradeHandlerAbi,
    functionName: "upgradeStatus",
    args: [id as Hex],
  });
  const isStandard = status[0] !== 0;
  return redirect(
    isStandard ? $path("/app/proposals/:id", { id }) : $path("/app/emergency/:id", { id })
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl leading-8 tracking-tight">Governance review</h1>
        <section aria-label="Open a proposal" className="min-w-0">
          <ProposalLookup
            error={actionData?.error ?? null}
            defaultId={actionData?.id ?? ""}
            submitting={navigation.state === "submitting"}
          />
        </section>
      </header>

      <section className="space-y-3" aria-labelledby="governance-actions">
        <h2 id="governance-actions" className="font-semibold text-lg">
          Governance actions
        </h2>
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-300 bg-white">
          <FlowRow
            to={$path("/app/proposals")}
            icon={<Rocket />}
            title="Protocol upgrades"
            description="L2 decisions started on L1, with Security Council or Guardian approval."
            summary={
              <Deferred
                value={data.upgrades}
                fresh={data.upgradesFresh}
                indexed
                watchKey={"list:upgrades"}
              >
                {(v, note, current) => (
                  <OverviewSummary
                    count={v.open}
                    label="in progress"
                    detail={`${v.total - v.open} finished in the last 45 days`}
                    note={note}
                    emphasize={current}
                    tone="active"
                    from="chain"
                  />
                )}
              </Deferred>
            }
            testId="flow-upgrades"
          />
          <FlowRow
            to={$path("/app/emergency")}
            icon={<ShieldAlert />}
            title="Emergency upgrades"
            description="Upgrade IDs signed by the Council, Guardians, and ZKsync Foundation."
            summary={
              <Deferred
                value={data.emergency}
                fresh={data.emergencyFresh}
                after={data.emergencyAfter}
                indexed
                watchKey={"list:emergency"}
              >
                {(v, note, current) => (
                  <OverviewSummary
                    count={v.pending}
                    label="pending"
                    detail={`${v.executed} executed in the last ${EMERGENCY_RECENT_DAYS} days`}
                    incomplete={v.incomplete}
                    note={note}
                    emphasize={current}
                    from="safe"
                  />
                )}
              </Deferred>
            }
            testId="flow-emergency"
          />
          <FlowRow
            to={$path("/app/freeze")}
            icon={<Snowflake />}
            title="Freeze requests"
            description="Council requests to freeze, unfreeze, or change the soft-freeze threshold."
            summary={
              <Deferred
                value={data.freeze}
                fresh={data.freezeFresh}
                after={data.freezeAfter}
                watchKey={"list:freeze"}
              >
                {(v, note, current) => (
                  <OverviewSummary
                    count={v.open}
                    label="open for signatures"
                    detail={freezeDetail(v)}
                    incomplete={v.incomplete}
                    note={note}
                    emphasize={current}
                    from="safe"
                  />
                )}
              </Deferred>
            }
            testId="flow-freeze"
          />
          <FlowRow
            to={$path("/app/l2-cancellations")}
            icon={<Ban />}
            title="Guardian veto"
            description="Guardian cancellations of Token or GovOps proposals before execution."
            summary={
              <Deferred value={data.vetoes} fresh={data.vetoesFresh} after={data.vetoesAfter}>
                {(v, note, current) => (
                  <OverviewSummary
                    count={v.open}
                    label="open vetoes"
                    incomplete={v.incomplete}
                    detail={v.incomplete ? undefined : `${v.vetoable} L2 proposals can be vetoed`}
                    note={note}
                    emphasize={current}
                    from="safe"
                  />
                )}
              </Deferred>
            }
            testId="flow-veto"
          />
        </div>
      </section>
    </div>
  );
}

const fullId = /^0x[0-9a-fA-F]{64}$/;

// What the field holds so far, measured against a 32-byte ID: the format stays in view while typing.
// `tried`: Open was pressed, so an incomplete ID says what is missing.
function idHint(value: string, tried: boolean): { text: string; problem: boolean } {
  const v = value.trim();
  if (v === "")
    return tried
      ? { text: "Enter a proposal ID: 0x and 64 hexadecimal characters", problem: true }
      : { text: "An upgrade or emergency upgrade ID", problem: false };
  if (!v.startsWith("0x") && !"0x".startsWith(v)) return { text: "Starts with 0x", problem: true };
  const hex = v.slice(2);
  if (/[^0-9a-fA-F]/.test(hex)) return { text: "Only 0–9 and a–f after 0x", problem: true };
  if (hex.length > 64)
    return { text: `${hex.length} of 64 hexadecimal characters · too long`, problem: true };
  if (hex.length === 64)
    return { text: "64 of 64 hexadecimal characters · ready to open", problem: false };
  return {
    text: `${hex.length} of 64 hexadecimal characters${tried ? " · enter all 64 to open" : ""}`,
    problem: tried,
  };
}

function ProposalLookup({
  error,
  defaultId,
  submitting,
}: { error: string | null; defaultId: string; submitting: boolean }) {
  const [value, setValue] = useState(defaultId);
  const [tried, setTried] = useState(false);
  const hint = idHint(value, tried);
  // The server's answer is about the ID it was sent: editing the field brings the live hint back.
  const shownError = value === defaultId ? error : null;
  return (
    <Form
      method="post"
      // Only a complete ID is sent (the action checks it again).
      onSubmit={(e) => {
        const id = new FormData(e.currentTarget).get("id");
        if (typeof id === "string" && fullId.test(id.trim())) return;
        e.preventDefault();
        setTried(true);
      }}
      className="grid max-w-[600px] gap-y-1.5"
    >
      <label htmlFor="proposal-id" className="font-semibold text-[14px] text-navy-800 leading-5">
        Open a proposal by ID
      </label>
      {/* One control: the field and its button share an edge and a height. */}
      <div className="flex min-w-0">
        <Input
          id="proposal-id"
          name="id"
          defaultValue={defaultId}
          placeholder="0x + 64 hexadecimal characters"
          className="mono h-11 min-w-0 flex-1 rounded-r-none px-3 text-[12px] placeholder:font-sans placeholder:text-[13px] placeholder:text-slate-500 focus-visible:z-10 sm:h-10"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setTried(false);
          }}
          aria-invalid={shownError || hint.problem ? true : undefined}
          aria-describedby={shownError ? "proposal-error" : "proposal-hint"}
        />
        <Button type="submit" loading={submitting} className="h-11 rounded-l-none px-4 sm:h-10">
          Open <ArrowRight />
        </Button>
      </div>
      {shownError ? (
        <p id="proposal-error" role="alert" className="text-red-800 text-xs">
          {shownError}
        </p>
      ) : (
        <p
          id="proposal-hint"
          aria-live="polite"
          className={cn("text-xs", hint.problem ? "font-medium text-amber-900" : "text-slate-550")}
        >
          {hint.text}
        </p>
      )}
    </Form>
  );
}

// Every row reads the same way: icon, title and status on the first line, the description and the
// supporting numbers on the second. The whole row is the link.
function FlowRow({
  to,
  icon,
  title,
  description,
  summary,
  testId,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  summary: ReactNode;
  testId: string;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="group grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-slate-75 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600 focus-visible:ring-inset active:bg-slate-100 has-[[data-tone=attention]]:bg-orange-50/60 has-[[data-tone=attention]]:hover:bg-orange-50 sm:grid-cols-[20px_minmax(0,1fr)_300px_16px] sm:gap-x-4 sm:px-5"
      data-testid={testId}
    >
      <span aria-hidden className="mt-0.5 text-navy-800 [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-semibold text-base text-navy-800 leading-6 group-hover:text-brand-700 group-hover:underline group-hover:underline-offset-4">
          {title}
        </h3>
        <p className="text-slate-550 text-xs">{description}</p>
      </div>
      <div className="col-start-2 sm:col-start-3">{summary}</div>
      <ArrowRight
        aria-hidden
        className="mt-1 hidden h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 sm:block"
      />
    </Link>
  );
}

/**
 * `indexed`: read from the upgrade handler's log index, so while the index backfills the pending
 * state says so (never a count: the count appears only once the range it covers is complete).
 */
function Deferred<T extends { source: SummarySource }>({
  value,
  fresh,
  after,
  indexed = false,
  watchKey,
  children,
}: {
  value: Promise<T> | T;
  fresh: Promise<T | null> | T | null;
  /** After a pause: what replaces a `fresh` count that is not fresh yet (see UntilFresh). */
  after?: Promise<T | null> | T | null;
  indexed?: boolean;
  /** The list the count is built from: a current count not re-read at the head served says so. */
  watchKey?: string;
  /** `current`: fresh and read at the head served, the only count that may be highlighted. */
  children: (v: T, note: ReactNode, current: boolean) => ReactNode;
}) {
  const { block, behind } = useContentCurrency(watchKey);
  const notReRead =
    block !== null && behind !== null ? (
      <p className="text-amber-900 text-xs" data-testid="not-reread">
        {notReReadHeadline(block, behind)}
      </p>
    ) : null;
  return (
    <Suspense fallback={<DeferredPending indexed={indexed} />}>
      <Await
        resolve={value}
        errorElement={
          <span className="inline-flex h-6 items-center gap-1.5 font-semibold text-[14px] text-red-800">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Data unavailable · open to retry
          </span>
        }
      >
        {(first) => {
          const v = first as T;
          return (
            <UntilFresh
              stale={v.source !== null}
              fresh={fresh as Promise<T | null>}
              after={after as Promise<T | null> | undefined}
              staleOf={(c) => c.source !== null}
            >
              {(freshValue, refresh) => {
                const shown = freshValue ?? v;
                return shown.source === null
                  ? children(shown, notReRead, notReRead === null)
                  : children(shown, <SummaryNote source={shown.source} refresh={refresh} />, false);
              }}
            </UntilFresh>
          );
        }}
      </Await>
    </Suspense>
  );
}

function DeferredPending({ indexed }: { indexed: boolean }) {
  const progress = useIndexProgress();
  return (
    <span role="status" className="inline-flex flex-col text-slate-600 text-xs">
      <span className="my-0.5 h-5 w-28 animate-pulse rounded-full bg-slate-100" />
      {indexed && progress.indexing ? indexingLabel(progress, "log history") : "Reading sources…"}
    </span>
  );
}
