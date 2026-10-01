import { listEmergencyUpgrades } from "@/.server/flows/emergency";
import { listFreezeRequests } from "@/.server/flows/freeze";
import { listL2Vetoes } from "@/.server/flows/l2-veto";
import { listStandardUpgrades } from "@/.server/flows/standard";
import { network, l1 } from "@/.server/rpc";
import { bytes32Pattern } from "@/.server/request";
import { upgradeHandlerAbi } from "@/common/abis";
import { isUpgradeActive } from "@/common/upgrade-states";
import { useStatus } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    emergency: listEmergencyUpgrades().then((r) => ({
      pending: r.pending.length,
      executed: r.executed.length,
    })),
    freeze: listFreezeRequests().then((r) => ({
      open: r.requests.filter((q) => q.state.status === "open").length,
    })),
    vetoes: listL2Vetoes().then((r) => ({
      open: r.vetoes.filter((v) => v.state.status === "open").length,
      vetoable: r.vetoable.length,
    })),
  });
}

// Upgrade and emergency ids are both bytes32; the handler knows which one it is.
export async function action({ request }: ActionFunctionArgs) {
  const id = String((await request.formData()).get("id") ?? "").trim();
  if (!bytes32Pattern.test(id))
    return json({ error: "Enter a 32-byte id (0x followed by 64 hex characters)." });
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
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-[20px] bg-navy-100 px-6 py-12 sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(60% 80% at 0% 0%, #FFF6E5 0%, rgba(255,246,229,0) 70%)",
          }}
        />
        <div className="relative max-w-2xl space-y-4">
          <h1 className="text-[40px] leading-[48px] tracking-[-0.03em] sm:text-[48px] sm:leading-[56px]">
            ZKsync governance, <span className="font-extrabold">verified on-chain.</span>
          </h1>
          <p className="text-[17px] text-slate-950 leading-7">
            Proposals come from the ProtocolUpgradeHandler on {governance.network.label}. Signatures
            come from members' Safes and count only when the governance contract itself accepts
            them, in an <span className="mono">eth_call</span> through your RPC.
          </p>
          <Card className="mt-6 p-2">
            <Form method="post" className="flex flex-col gap-2 sm:flex-row">
              <Input
                name="id"
                placeholder="Open an upgrade or emergency id (0x…)"
                className="mono border-transparent text-[13px] focus-visible:border-brand-600"
                aria-label="Upgrade or emergency id"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" loading={navigation.state === "submitting"}>
                Open <ArrowRight />
              </Button>
            </Form>
          </Card>
          {actionData?.error && <p className="text-red-700 text-sm">{actionData.error}</p>}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <FlowCard
          to={$path("/app/proposals")}
          icon={<Rocket />}
          title="Protocol upgrades"
          description="Upgrades voted on ZKsync Era and started on L1. The Security Council approves, Guardians may approve or extend the legal veto."
          summary={
            <Deferred value={data.upgrades}>
              {(v) => `${v.open} in progress · ${v.total} in the last 45 days`}
            </Deferred>
          }
          testId="flow-upgrades"
        />
        <FlowCard
          to={$path("/app/emergency")}
          icon={<ShieldAlert />}
          title="Emergency upgrades"
          description="Executed immediately with Security Council, Guardians and ZKsync Foundation signatures over the upgrade id."
          summary={
            <Deferred value={data.emergency}>
              {(v) => `${v.pending} pending · ${v.executed} executed`}
            </Deferred>
          }
          testId="flow-emergency"
        />
        <FlowCard
          to={$path("/app/freeze")}
          icon={<Snowflake />}
          title="Freeze requests"
          description="Soft and hard freezes, unfreeze, and the soft-freeze threshold, signed by the Security Council."
          summary={
            <Deferred value={data.freeze}>{(v) => `${v.open} open for signatures`}</Deferred>
          }
          testId="flow-freeze"
        />
        <FlowCard
          to={$path("/app/l2-cancellations")}
          icon={<Ban />}
          title="Guardian veto"
          description="Guardians cancel a proposal on the ZKsync Era Token or GovOps governor before it executes."
          summary={
            <Deferred value={data.vetoes}>
              {(v) => `${v.open} open vetoes · ${v.vetoable} L2 proposals can be vetoed`}
            </Deferred>
          }
          testId="flow-veto"
        />
      </section>
    </div>
  );
}

function FlowCard({
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
    <Link to={to} className="group" data-testid={testId}>
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors group-hover:border-slate-300">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-800/[0.08] text-navy-800 [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </span>
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 font-medium text-[19px] text-slate-950">
            {title}
            <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
          </h3>
          <p className="text-slate-950 text-sm leading-6">{description}</p>
        </div>
        <p className="mt-auto text-slate-600 text-sm">{summary}</p>
      </Card>
    </Link>
  );
}

function Deferred<T>({
  value,
  children,
}: { value: Promise<T> | T; children: (v: T) => ReactNode }) {
  return (
    <Suspense
      fallback={<span className="inline-block h-4 w-40 animate-pulse rounded bg-slate-100" />}
    >
      <Await
        resolve={value}
        errorElement={<span className="text-amber-700">Could not load (see the page)</span>}
      >
        {(v) => children(v as T)}
      </Await>
    </Suspense>
  );
}
