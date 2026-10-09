import { listRecentEmergencyUpgrades } from "@/.server/flows/emergency";
import { EMERGENCY_RECENT_DAYS } from "@/common/emergency";
import { listFreezeRequests } from "@/.server/flows/freeze";
import { listL2Vetoes } from "@/.server/flows/l2-veto";
import { listStandardUpgrades } from "@/.server/flows/standard";
import { network, l1 } from "@/.server/rpc";
import { bytes32Pattern } from "@/.server/request";
import { upgradeHandlerAbi } from "@/common/abis";
import { isUpgradeActive } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { OverviewSummary } from "@/components/overview-summary";
import { indexingLabel, useIndexProgress } from "@/components/sync-state";
import { Input } from "@/components/ui/input";
import { Meta } from "@/utils/meta";
import { type ActionFunctionArgs, defer, json, redirect } from "@remix-run/node";
import { Await, Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { ArrowRight, Ban, Rocket, ShieldAlert, Snowflake } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { $path } from "remix-routes";
import type { Hex } from "viem";

export const meta = Meta["/"];

export function loader() {
  return defer({
    upgrades: listStandardUpgrades({ allHistory: false }).then((r) => ({
      open: r.upgrades.filter((u) => isUpgradeActive(u.state)).length,
      total: r.upgrades.length,
    })),
    emergency: listRecentEmergencyUpgrades().then((r) => ({
      pending: r.pending.length,
      executed: r.executed.length,
      incomplete: r.errors.length > 0 || r.anomalies > 0,
    })),
    freeze: listFreezeRequests().then((r) => ({
      open: r.requests.filter((q) => q.state.status === "open").length,
      incomplete: r.errors.length > 0 || r.anomalies > 0,
    })),
    vetoes: listL2Vetoes().then((r) => ({
      open: r.vetoes.filter((v) => v.state.status === "open").length,
      vetoable: r.vetoable.length,
      incomplete: r.errors.length > 0 || r.anomalies > 0 || r.l2Error !== null,
    })),
  });
}

// Upgrade and emergency ids are both bytes32; the handler knows which one it is.
export async function action({ request }: ActionFunctionArgs) {
  const id = String((await request.formData()).get("id") ?? "").trim();
  if (!bytes32Pattern.test(id))
    return json({ id, error: "Enter a 32-byte id: 0x followed by 64 hexadecimal characters." });
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
  const { governance } = useStatus();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-[32px] leading-10 tracking-tight">Governance review</h1>
        <p className="max-w-3xl text-slate-700 text-sm leading-6">
          Review proposals on {governance.network.label}, inspect their calls, and compare the
          hashes your Safe signs. Signatures count only after the contract accepts them.
        </p>
      </header>

      <section className="rounded-xl bg-navy-800 p-5 sm:p-6" aria-labelledby="proposal-lookup">
        <div className="grid gap-4 lg:grid-cols-[200px_1fr] lg:items-start">
          <div className="space-y-1">
            <h2 id="proposal-lookup" className="font-semibold text-lg text-white">
              Open a proposal
            </h2>
            <p className="text-indigo-100 text-sm">Paste an upgrade or emergency id.</p>
          </div>
          <Form method="post" className="space-y-2">
            <label htmlFor="proposal-id" className="sr-only">
              Upgrade or emergency id
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="proposal-id"
                name="id"
                defaultValue={actionData?.id ?? ""}
                placeholder="0x followed by 64 hexadecimal characters"
                className="mono h-11 min-w-0 flex-1 text-[13px]"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={actionData?.error ? true : undefined}
                aria-describedby={actionData?.error ? "proposal-error" : "proposal-hint"}
              />
              <Button
                type="submit"
                loading={navigation.state === "submitting"}
                className="h-11 border-white hover:border-white"
              >
                Open <ArrowRight />
              </Button>
            </div>
            {actionData?.error ? (
              <p
                id="proposal-error"
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-red-900 text-sm"
              >
                {actionData.error}
              </p>
            ) : (
              <p id="proposal-hint" className="text-indigo-100 text-xs">
                Opens the proposal for review. No wallet connection needed.
              </p>
            )}
          </Form>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="governance-actions">
        <h2 id="governance-actions" className="text-xl">
          Governance actions
        </h2>
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-300 bg-white">
          <FlowRow
            to={$path("/app/proposals")}
            icon={<Rocket />}
            title="Protocol upgrades"
            description="L2 decisions started on L1, with Security Council or Guardian approval."
            summary={
              <Deferred value={data.upgrades} indexed>
                {(v) => (
                  <OverviewSummary
                    count={v.open}
                    label="in progress"
                    detail={`${v.total} upgrade${v.total === 1 ? "" : "s"} in the last 45 days`}
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
            description="Upgrade ids signed by the Council, Guardians, and ZKsync Foundation."
            summary={
              <Deferred value={data.emergency} indexed>
                {(v) => (
                  <OverviewSummary
                    count={v.pending}
                    label="pending"
                    detail={`${v.executed} executions in the last ${EMERGENCY_RECENT_DAYS} days`}
                    incomplete={v.incomplete}
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
              <Deferred value={data.freeze}>
                {(v) => (
                  <OverviewSummary
                    count={v.open}
                    label="open for signatures"
                    incomplete={v.incomplete}
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
              <Deferred value={data.vetoes}>
                {(v) => (
                  <OverviewSummary
                    count={v.open}
                    label="open vetoes"
                    incomplete={v.incomplete}
                    detail={v.incomplete ? undefined : `${v.vetoable} L2 proposals can be vetoed`}
                  />
                )}
              </Deferred>
            }
            testId="flow-veto"
          />
        </div>
        <p className="text-slate-600 text-xs">
          Safe discovery can be incomplete when its API is unavailable. Open a known id to review
          the on-chain evidence directly.
        </p>
      </section>
    </div>
  );
}

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
      className="group grid gap-3 px-5 py-5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_220px_20px] sm:items-center sm:gap-6 sm:px-6"
      data-testid={testId}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-navy-800 [&_svg]:size-5">
          {icon}
        </span>
        <div className="space-y-1">
          <h3 className="font-semibold text-base text-navy-800">{title}</h3>
          <p className="max-w-2xl text-slate-700 text-sm leading-6">{description}</p>
        </div>
      </div>
      <div className="pl-8 sm:pl-0">{summary}</div>
      <ArrowRight
        aria-hidden
        className="hidden h-4 w-4 text-slate-600 group-hover:text-brand-700 sm:block"
      />
    </Link>
  );
}

/**
 * A count, once its sources answered. `indexed`: it is read from the upgrade handler's log index,
 * so while the index backfills the pending state says so (never a count: the count appears only
 * once the range it covers is complete).
 */
function Deferred<T>({
  value,
  indexed = false,
  children,
}: { value: Promise<T> | T; indexed?: boolean; children: (v: T) => ReactNode }) {
  return (
    <Suspense fallback={<DeferredPending indexed={indexed} />}>
      <Await
        resolve={value}
        errorElement={
          <span className="font-medium text-amber-900 text-sm">
            Data unavailable · open to retry
          </span>
        }
      >
        {(v) => children(v as T)}
      </Await>
    </Suspense>
  );
}

function DeferredPending({ indexed }: { indexed: boolean }) {
  const progress = useIndexProgress();
  return (
    <span role="status" className="inline-flex flex-col gap-1.5 text-slate-600 text-xs">
      <span className="h-4 w-28 animate-pulse rounded bg-slate-100" />
      {indexed && progress.indexing ? indexingLabel(progress, "log history") : "Reading sources…"}
    </span>
  );
}
