import ConnectButton, { WalletOfferContext } from "@/components/connect-button";
import {
  type ChainView,
  type OkStatus,
  type RootStatus,
  StatusBoundary,
  type StatusProblemValue,
  type StatusSource,
  StatusSourceContext,
  WithStatus,
  useChain,
} from "@/components/governance-context";
import { AddressLink } from "@/components/hex";
import Logo from "@/components/logo";
import { useLive } from "@/components/presence";
import {
  BlockAge,
  IndexProgressProvider,
  IndexingPill,
  useNowSeconds,
} from "@/components/sync-state";
import { Button } from "@/components/ui/button";
import { contentCurrency, useContentCurrency } from "@/components/verification/content-currency";
import { cn } from "@/utils/cn";
import { formatAge, formatNumber } from "@/utils/format";
import { noteStatusLanded, requestStatusRevalidation } from "@/utils/revalidation";
import { Link, NavLink, useFetcher, useRevalidator } from "@remix-run/react";
import { AlertTriangle, Clock, Info, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";

export { useStatus } from "@/components/governance-context";

// The app shell renders at once, before the root status (governance, trust anchors, log history)
// is read: the header, the navigation and each page's own skeletons are in the first bytes of the
// response. What the status says (the block and its age, banners, the footer's trust anchors)
// fills in when it is read; until then it says it is being checked, never that all is well.

const NAV = [
  { to: $path("/app/proposals"), label: "Upgrades" },
  { to: $path("/app/emergency"), label: "Emergency" },
  { to: $path("/app/freeze"), label: "Freeze" },
  { to: $path("/app/l2-cancellations"), label: "L2 veto" },
  { to: "/settings", label: "Settings" },
];

/**
 * The root status once it is in this browser: right away for a status in hand, else when its
 * promise settles (after hydration, so the server's and the browser's first renders agree).
 */
function useLandedStatus(source: StatusSource): RootStatus | null {
  const [landed, setLanded] = useState<{ source: StatusSource; status: RootStatus } | null>(() =>
    source instanceof Promise ? null : { source, status: source }
  );
  useEffect(() => {
    if (!(source instanceof Promise)) {
      setLanded((current) => (current?.source === source ? current : { source, status: source }));
      return;
    }
    let live = true;
    source.then(
      (status) => {
        if (live) setLanded({ source, status });
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [source]);
  return landed?.source === source ? landed.status : null;
}

export default function AppShell({
  status,
  children,
  wallet = true,
}: {
  /** The root status, read while the shell streams (or in hand). */
  status: StatusSource;
  children: ReactNode;
  /** Whether a wallet provider is set up around the shell (it offers to connect one). */
  wallet?: boolean;
}) {
  // How many Sign / Send buttons are on screen; the header offers to connect only while some are.
  const [walletOffers, setWalletOffers] = useState(0);
  const landed = useLandedStatus(status);
  const ok = landed?.ok ? landed : null;
  // A new root status landed: it answers any request to read it again, and its age starts now.
  useEffect(() => {
    if (ok) noteStatusLanded(ok);
  }, [ok]);
  // The log index finished: read the status again, for its log-history check against the index.
  const { revalidate } = useRevalidator();
  const readStatusAgain = useCallback(() => {
    requestStatusRevalidation();
    revalidate();
  }, [revalidate]);
  return (
    <StatusSourceContext.Provider value={status}>
      <IndexProgressProvider initial={ok?.sync.index ?? null} onSettled={readStatusAgain}>
        <WalletOfferContext.Provider value={setWalletOffers}>
          <div className="flex min-h-screen flex-col">
            <SkipLink />
            <Header offerWallet={walletOffers > 0} wallet={wallet} />
            <Banners />
            <Main>
              <StatusBoundary source={status} problem={(p) => <StatusProblemCard problem={p} />}>
                {/* A page that needs the status before anything else waits for it here. */}
                <Suspense fallback={<PagePending />}>{children}</Suspense>
              </StatusBoundary>
            </Main>
            <Footer />
          </div>
        </WalletOfferContext.Provider>
      </IndexProgressProvider>
    </StatusSourceContext.Provider>
  );
}

/**
 * The shell before the app knows which chain the RPC is on (the first moments of a fresh
 * process): the header, the navigation and a page skeleton, nothing read yet.
 */
export function AppFrame() {
  return (
    <div className="flex min-h-screen flex-col" aria-busy="true">
      <SkipLink />
      <header className="sticky top-0 z-40 border-slate-300 border-b bg-white">
        <HeaderRow>
          <HomeLink />
          <Nav />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <NetworkPill chain={null} />
          </div>
        </HeaderRow>
      </header>
      <CheckingBanner />
      <Main>
        <PagePending />
      </Main>
    </div>
  );
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only z-50 rounded-lg bg-white px-4 py-3 font-semibold text-brand-700 focus:not-sr-only focus:fixed focus:top-2 focus:left-4"
    >
      Skip to content
    </a>
  );
}

function Main({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 sm:py-8"
    >
      {children}
    </main>
  );
}

function HeaderRow({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 md:h-16 md:flex-nowrap md:py-0">
      {children}
    </div>
  );
}

function HomeLink() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-3" aria-label="Home">
      <Logo className="h-6 w-auto" />
      {/* Not beside the links on narrower desktops (md to xl): they would not all fit. */}
      <span className="hidden h-5 w-px bg-slate-200 sm:block md:hidden xl:block" />
      <span className="hidden font-medium text-[15px] text-slate-950 sm:block md:hidden xl:block">
        Governance
      </span>
    </Link>
  );
}

function Nav() {
  return (
    <nav
      aria-label="Governance navigation"
      // From md up the links share one row with the network pill and the wallet button: when they
      // do not all fit, the links scroll within the navigation rather than run under the pill.
      className="-mx-2 order-last flex w-full min-w-0 flex-wrap items-center gap-1 md:order-none md:w-auto md:flex-1 md:flex-nowrap md:overflow-x-auto"
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          prefetch="intent"
          className={({ isActive }) =>
            cn(
              "flex min-h-11 items-center whitespace-nowrap rounded-[10px] px-3 py-2 font-medium text-slate-700 text-sm transition-colors hover:bg-slate-75 hover:text-slate-950",
              isActive && "bg-navy-800 font-semibold text-white hover:bg-navy-800 hover:text-white"
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The block the header names: the head the last beat named (the engine serves) when the status
 * this tab shows was read there too (the beats' notedAt for "status"); otherwise the status's own
 * block, whose age then grows. Never a block newer than the status it sits over.
 */
export function headerBlock(
  status: { number: string; timestamp: string },
  live: {
    head: { number: string; timestamp: string } | null;
    notedAt?: Record<string, { rev: string; block: string }>;
  }
) {
  const { head } = live;
  const { block, behind } = contentCurrency("status", live);
  if (!head || block === null || behind !== null || BigInt(head.number) <= BigInt(status.number))
    return status;
  return head;
}

/**
 * What the tab's live updates are doing, when it is worth saying: reloading after a change,
 * catching up after a pause, or paused (away, or the server not answering). Nothing otherwise.
 * It floats over the bottom of the page, outside the header and the page's flow: appearing and
 * going, it never moves the page (or the header's height on a phone) and never covers the
 * navigation. It takes no clicks: whatever is under it stays usable.
 */
function LiveNote() {
  const live = useLive();
  const now = useNowSeconds();
  let text: string | null = null;
  if (live.away) text = "Updates paused while you're away";
  else if (live.failing)
    text =
      live.lastBeatAt && now !== null
        ? `Updates paused · last checked ${formatAge(now - live.lastBeatAt / 1000)}`
        : "Updates paused";
  else if (live.updating) text = "Updating…";
  else if (live.catchingUp) text = "Checking for changes…";
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-30 flex max-w-[calc(100vw-2rem)] justify-end sm:right-6">
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700 text-xs shadow-[0_8px_16px_-4px_rgba(10,26,102,0.16)]"
        data-testid="live-note"
      >
        {(live.updating || live.catchingUp) && !live.away && !live.failing && (
          <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
        )}
        <span>{text}</span>
      </span>
    </div>
  );
}

function Header({ offerWallet, wallet }: { offerWallet: boolean; wallet: boolean }) {
  const chain = useChain();
  const live = useLive();
  return (
    <>
      <header className="sticky top-0 z-40 border-slate-300 border-b bg-white">
        <HeaderRow>
          <HomeLink />
          <Nav />
          {/* On a phone the group may wrap onto a second line rather than widen the page. */}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <WithStatus
              fallback={<NetworkPill chain={chain} />}
              problem={() => <NetworkPill chain={chain} unavailable />}
            >
              {(status) => (
                <>
                  <IndexingPill fallback={status.sync.index} />
                  <NetworkPill
                    chain={status.governance.network}
                    block={headerBlock(status.governance.latestBlock, live)}
                    notReRead={contentCurrency("status", live).behind !== null}
                  />
                </>
              )}
            </WithStatus>
            <RefreshButton />
            {wallet && (
              <WithStatus fallback={null}>{() => <ConnectButton offer={offerWallet} />}</WithStatus>
            )}
          </div>
        </HeaderRow>
      </header>
      {/* Once the status is read (before, the checking banner floats there). */}
      <WithStatus fallback={null} problem={() => null}>
        {() => <LiveNote />}
      </WithStatus>
    </>
  );
}

/**
 * The chain the RPC is on and, once the status is read, the block it was read at and how long
 * ago that was mined. Until then it says so ("checking…"), with a neutral dot.
 */
function NetworkPill({
  chain,
  block,
  unavailable = false,
  notReRead = false,
}: {
  chain: Pick<ChainView, "label" | "isDevNode"> | null;
  block?: { number: string; timestamp: string };
  unavailable?: boolean;
  /**
   * The status under it was not read again at the head served now (TrustBanners says so): its
   * own block, never in a passing colour.
   */
  notReRead?: boolean;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-slate-50 px-2 py-2 font-semibold text-navy-800 text-xs"
      data-testid="network-pill"
      data-stale={notReRead ? "true" : undefined}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          !block ? "bg-slate-300" : chain?.isDevNode || notReRead ? "bg-amber-500" : "bg-green-500"
        )}
        data-testid="network-dot"
      />
      <span className="truncate">{chain?.label ?? "Connecting"}</span>
      {block ? (
        <BlockAge block={block} />
      ) : (
        <span className="shrink-0 font-normal text-slate-600" data-testid="status-checking">
          {unavailable ? "unavailable" : "checking…"}
        </span>
      )}
    </span>
  );
}

/**
 * Drops cached Safe and chain answers, then reloads the page data. The router reloads it once,
 * by itself, after the POST, and the fetcher stays busy until that pass is done; a second
 * revalidate() here would load everything again. The click also asks for the root status
 * (see revalidation.ts), so a navigation that cuts that reload short still reads it.
 */
export function RefreshButton() {
  const fetcher = useFetcher<{ refreshed: boolean }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.refreshed)
      toast("Refreshed less than 10 s ago; showing cached Safe data.");
  }, [fetcher.state, fetcher.data]);
  const busy = fetcher.state !== "idle";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Refresh data"
      title="Fetch Safe signatures and chain state again"
      onClick={() => {
        requestStatusRevalidation();
        fetcher.submit(null, { method: "POST", action: $path("/resources/refresh") });
      }}
      disabled={busy}
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}

function Banner({
  tone,
  icon: Icon,
  spin = false,
  testId,
  children,
}: {
  tone: "error" | "warning" | "info";
  icon: typeof Info;
  spin?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-red-700 bg-red-50 text-red-900",
        tone === "warning" && "border-amber-600 bg-amber-50 text-amber-950",
        tone === "info" && "border-brand-100 bg-brand-50 text-navy-800"
      )}
      role={tone === "info" ? "status" : "alert"}
      data-testid={testId}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", spin && "motion-safe:animate-spin")} />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function BannerArea({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mt-4 w-full max-w-[1200px] space-y-2 px-4 sm:px-6">{children}</div>
  );
}

/**
 * Until the status is read: no banner can say all is well yet. It floats over the bottom of the
 * page rather than taking a place in it, so nothing on the page moves when it goes (a warning that
 * follows takes its place at the top, in the page).
 */
function CheckingBanner() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 px-4 sm:px-6">
      <div className="pointer-events-auto mx-auto max-w-[1200px] rounded-xl shadow-[0_12px_24px_-4px_rgba(10,26,102,0.16)]">
        <Banner tone="info" icon={Loader2} spin testId="status-checking-banner">
          <p>
            Checking the governance contracts, trust anchors and your RPC's log history… Warnings
            appear at the top of the page once they are read.
          </p>
        </Banner>
      </div>
    </div>
  );
}

function Banners() {
  return (
    <WithStatus
      fallback={<CheckingBanner />}
      problem={(problem) => (
        <BannerArea>
          <Banner tone="error" icon={ShieldAlert} testId="status-problem">
            <p className="font-semibold">Can't read the governance contracts.</p>
            <p>{problem.hint}</p>
            <p className="mono break-all">{problem.error}</p>
          </Banner>
        </BannerArea>
      )}
    >
      {(status) => <TrustBanners status={status} />}
    </WithStatus>
  );
}

function TrustBanners({ status }: { status: OkStatus }) {
  const { governance, logHistory } = status;
  const items: ReactNode[] = [];
  // The status not read again at the head served now: what the banners say (and that none shows)
  // is as of its block.
  const { block, behind } = useContentCurrency("status");
  if (block !== null && behind !== null) {
    items.push(
      <Banner key="not-reread" tone="warning" icon={Clock} testId="status-not-reread">
        <p>
          <span className="font-semibold">
            Status not re-read since block #{formatNumber(block)}.
          </span>{" "}
          The governance contracts, trust anchors and log history could not be read again at block #
          {formatNumber(behind)}: the warnings here, and that none is shown, are as of block #
          {formatNumber(block)}. This updates once they are read again.
        </p>
      </Banner>
    );
  }
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
  return <BannerArea>{items}</BannerArea>;
}

function Footer() {
  const chain = useChain();
  return (
    <footer id="data-sources" className="mt-12 border-slate-200 border-t bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-x-10 gap-y-3 px-4 py-8 text-[13px] sm:grid-cols-2 sm:px-6">
        <div className="space-y-3 sm:col-span-2">
          <p className="font-semibold text-[11px] text-slate-600 uppercase tracking-[0.08em]">
            Where this page's data comes from
          </p>
          <p className="max-w-3xl text-slate-950">
            Proposals and roles are read from the chain through your RPC. Signatures are fetched
            from the Safe Transaction Service and counted only after the governance contract accepts
            them in an <code className="mono">eth_call</code>.{" "}
            <WithStatus fallback={null}>
              {(status) => <CacheSentence state={status.sync.cache.state} />}
            </WithStatus>{" "}
            It never posts to Safe.
          </p>
        </div>
        <WithStatus
          fallback={<FooterPending chain={chain} />}
          problem={() => <FooterPending chain={chain} unavailable />}
        >
          {(status) => <FooterRows status={status} />}
        </WithStatus>
      </div>
    </footer>
  );
}

/** What this app keeps between runs, by the state of its chain cache (see /api/status sync.cache). */
export function CacheSentence({ state }: { state: OkStatus["sync"]["cache"]["state"] }) {
  return (
    <span data-testid="cache-sentence">
      {state === "disabled"
        ? "This app keeps nothing between runs: it reads its log history and Safe's copies again at every start."
        : "This app keeps a local cache of public chain and Safe data between runs (never verdicts, settings or keys): its log history is read from the chain again at every start, and saved Safe copies are shown with their age until Safe is read again."}
    </span>
  );
}

function FooterPending({
  chain,
  unavailable = false,
}: { chain: ChainView | null; unavailable?: boolean }) {
  return (
    <>
      <FooterRow label="Chain">
        {chain ? `${chain.label} · chain id ${chain.chainId}` : "Connecting…"}
      </FooterRow>
      <FooterRow label="Trust anchors">
        <span className="text-slate-600" role="status">
          {unavailable
            ? "Not available: the governance contracts could not be read."
            : "Reading the ProtocolUpgradeHandler and the roles it names…"}
        </span>
      </FooterRow>
    </>
  );
}

function FooterRows({ status }: { status: OkStatus }) {
  const g = status.governance;
  const quota = status.safeApi.quota;
  return (
    <>
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
    </>
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

/** A page that needs the status before anything else, while it is read. */
function PagePending() {
  return (
    <div className="space-y-4" aria-busy="true" data-testid="page-pending">
      <p role="status" className="text-slate-700">
        Reading governance data: your RPC, contract roles and network status…
      </p>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-8 w-64 max-w-full rounded bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded bg-slate-200" />
        <div className="h-24 w-full rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

/** In place of a page that needed the status, when it could not be read. */
function StatusProblemCard({ problem }: { problem: StatusProblemValue }) {
  return (
    <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-[0_12px_24px_-4px_rgba(10,26,102,0.08)]">
      <h1 className="mb-3 text-2xl">Can't read the governance contracts</h1>
      <p className="mb-4 text-slate-950">{problem.hint}</p>
      <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-red-800">
        {problem.error}
      </pre>
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
        <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-red-800">
          {error}
        </pre>
      </div>
    </div>
  );
}
