import type { AppStatus } from "@/.server/status";
import ConnectButton from "@/components/connect-button";
import { AddressLink } from "@/components/hex";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { RootLoader } from "@/root";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import type { SerializeFrom } from "@remix-run/node";
import { Link, NavLink, useFetcher, useRevalidator, useRouteLoaderData } from "@remix-run/react";
import { AlertTriangle, Info, RefreshCw, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";

type OkStatus = Extract<SerializeFrom<AppStatus>, { ok: true }>;

/** Governance context from the root loader (always present inside the shell). */
export function useStatus(): OkStatus {
  const data = useRouteLoaderData<RootLoader>("root");
  if (!data?.status.ok) throw new Error("App status unavailable");
  return data.status as OkStatus;
}

const NAV = [
  { to: $path("/app/proposals"), label: "Upgrades" },
  { to: $path("/app/emergency"), label: "Emergency" },
  { to: $path("/app/freeze"), label: "Freeze" },
  { to: $path("/app/l2-cancellations"), label: "L2 veto" },
];

export default function AppShell({ status, children }: { status: OkStatus; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header status={status} />
      <Banners status={status} />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">{children}</main>
      <Footer status={status} />
    </div>
  );
}

function Header({ status }: { status: OkStatus }) {
  const { network, latestBlock } = status.governance;
  return (
    <header className="sticky top-0 z-40 border-slate-200/60 border-b bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 md:h-16 md:flex-nowrap md:py-0">
        <Link to="/" className="flex shrink-0 items-center gap-3" aria-label="Home">
          <Logo className="h-6 w-auto" />
          <span className="hidden h-5 w-px bg-slate-200 sm:block" />
          <span className="hidden font-medium text-[15px] text-slate-950 sm:block">Governance</span>
        </Link>
        <nav className="no-scrollbar -mx-2 order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto md:order-none md:w-auto md:flex-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-[10px] px-3 py-1.5 font-medium text-slate-700 text-sm transition-colors hover:bg-slate-75 hover:text-slate-950",
                  isActive &&
                    "bg-brand-50 font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-600"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] text-slate-700 lg:inline-flex"
            title={`Block ${latestBlock.number} via your RPC`}
            data-testid="network-pill"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                network.isDevNode ? "bg-amber-500" : "bg-green-500"
              )}
            />
            {network.label}
            <span className="text-slate-400">#{formatNumber(latestBlock.number)}</span>
          </span>
          <RefreshButton />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

/** Drops cached Safe and chain answers, then reloads the page data. */
export function RefreshButton() {
  const fetcher = useFetcher<{ refreshed: boolean }>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      revalidator.revalidate();
      if (!fetcher.data.refreshed) toast("Refreshed less than 10 s ago; showing cached Safe data.");
    }
  }, [fetcher.state, fetcher.data, revalidator.revalidate]);
  const busy = fetcher.state !== "idle" || revalidator.state !== "idle";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Refresh data"
      title="Fetch Safe signatures and chain state again"
      onClick={() => fetcher.submit(null, { method: "POST", action: $path("/resources/refresh") })}
      disabled={busy}
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}

function Banner({
  tone,
  icon: Icon,
  children,
}: { tone: "error" | "warning" | "info"; icon: typeof Info; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "info" && "border-brand-100 bg-brand-50 text-navy-800"
      )}
      role={tone === "info" ? "status" : "alert"}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function Banners({ status }: { status: OkStatus }) {
  const { governance, logHistory } = status;
  const items: ReactNode[] = [];
  if (governance.warnings.length > 0) {
    items.push(
      <Banner key="warnings" tone="error" icon={ShieldAlert}>
        <p className="font-semibold">
          The governance contracts disagree with each other. Do not sign until this is explained.
        </p>
        <ul className="list-disc pl-5">
          {governance.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Banner>
    );
  }
  if (governance.network.overrides.length > 0) {
    items.push(
      <Banner key="overrides" tone="warning" icon={AlertTriangle}>
        <p>
          <span className="font-semibold">Non-default trust anchor.</span>{" "}
          {governance.network.overrides.join(", ")}{" "}
          {governance.network.overrides.length === 1 ? "is" : "are"} set in this app's environment.
          Check the addresses in the footer are the ones you expect.
        </p>
      </Banner>
    );
  }
  if (logHistory.status === "missing" || logHistory.status === "error") {
    items.push(
      <Banner key="logs" tone="warning" icon={AlertTriangle}>
        <p>
          <span className="font-semibold">Your RPC may not serve old logs.</span>{" "}
          {logHistory.status === "missing"
            ? `It returned nothing for a known event at block ${logHistory.blockNumber}, so lists of proposals can be incomplete.`
            : `eth_getLogs failed: ${logHistory.message}`}{" "}
          Proposal pages opened by id still verify. Use an RPC with log history to see every
          proposal.
        </p>
      </Banner>
    );
  }
  if (governance.network.isDevNode) {
    items.push(
      <Banner key="dev" tone="info" icon={Info}>
        <p>
          Connected to a local development node ({status.clientVersion}). Nothing derived from it is
          cached.
        </p>
      </Banner>
    );
  }
  if (items.length === 0) return null;
  return <div className="mx-auto mt-4 w-full max-w-[1200px] space-y-2 px-4 sm:px-6">{items}</div>;
}

function Footer({ status }: { status: OkStatus }) {
  const g = status.governance;
  const quota = status.safeApi.quota;
  return (
    <footer className="mt-16 border-slate-200 border-t bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-x-10 gap-y-3 px-4 py-8 text-[13px] sm:grid-cols-2 sm:px-6">
        <div className="space-y-3 sm:col-span-2">
          <p className="font-semibold text-[11px] text-slate-600 uppercase tracking-[0.08em]">
            Where this page's data comes from
          </p>
          <p className="max-w-3xl text-slate-950">
            Proposals and roles are read from the chain through your RPC. Signatures are fetched
            from the Safe Transaction Service and counted only after the governance contract accepts
            them in an <code className="mono">eth_call</code>. This app stores nothing and never
            posts to Safe.
          </p>
        </div>
        <FooterRow label="Chain">
          {g.network.label} · chain id {g.network.chainId}
        </FooterRow>
        <FooterRow label="ProtocolUpgradeHandler (pinned)">
          <AddressLink address={g.upgradeHandler} />
        </FooterRow>
        <FooterRow label={`Security Council · ${g.securityCouncil.members.length} members`}>
          <AddressLink address={g.securityCouncil.address} />
        </FooterRow>
        <FooterRow label={`Guardians · ${g.guardians.members.length} members`}>
          <AddressLink address={g.guardians.address} />
        </FooterRow>
        <FooterRow label="Emergency Upgrade Board">
          <AddressLink address={g.emergencyUpgradeBoard.address} />
        </FooterRow>
        <FooterRow label="ZKsync Foundation Safe">
          <AddressLink address={g.emergencyUpgradeBoard.zkFoundation} />
        </FooterRow>
        <FooterRow label="Safe Transaction Service">
          <span className="mono break-all">{status.safeApi.url ?? "not configured"}</span>
          {quota.remaining !== null && (
            <span className="ml-2 text-slate-600">
              {formatNumber(quota.remaining)} of {formatNumber(quota.limit ?? 0)} requests left
              {status.safeApi.withKey ? "" : " this month (no API key)"}
            </span>
          )}
        </FooterRow>
        <FooterRow label="L2 (ZKsync Era) RPC">
          {status.l2RpcConfigured ? "configured" : "not configured — L2 veto data unavailable"}
        </FooterRow>
      </div>
    </footer>
  );
}

function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-slate-600">{label}</span>
      <span className="min-w-0 text-slate-950">{children}</span>
    </div>
  );
}

export function StatusProblem({ error, hint }: { error: string; hint: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-100 px-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-[0_12px_24px_-4px_rgba(10,26,102,0.08)]">
        <Logo className="mb-8 h-6 w-auto" />
        <h1 className="mb-3 text-2xl">Can't read the governance contracts</h1>
        <p className="mb-4 text-slate-950">{hint}</p>
        <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-red-700">
          {error}
        </pre>
      </div>
    </div>
  );
}
