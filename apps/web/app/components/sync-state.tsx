import type { OkStatus } from "@/components/governance-context";
import { LoadingCard } from "@/components/page";
import { cn } from "@/utils/cn";
import { formatAge, formatNumber, formatTime } from "@/utils/format";
import { Loader2 } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { $path } from "remix-routes";

// What the header says about the data behind the page: the block the app status was read at and
// how long ago that block was mined (by this browser's clock), and whether the
// ProtocolUpgradeHandler's log index is still backfilling. The root status is not read again on
// every navigation (see utils/revalidation.ts), so the age keeps growing until it is.

export type IndexStatusView = OkStatus["sync"]["index"];

/** `percent` is null when there is no measure yet; it stays below 100 until the index is ready. */
export type IndexProgress = { indexing: boolean; percent: number | null };

const NOT_INDEXING: IndexProgress = { indexing: false, percent: null };

/**
 * Backfill progress: chunks landed of chunks planned, or (before any chunk was planned, e.g. while
 * a full-range request is out) the share of [deployBlock, finalizedTo] covered.
 */
export function indexProgress(index: IndexStatusView | null | undefined): IndexProgress {
  if (!index || index.state !== "backfilling") return NOT_INDEXING;
  let ratio: number | null = null;
  if (index.chunks.total > 0) ratio = index.chunks.done / index.chunks.total;
  else if (index.deployBlock && index.finalizedTo && index.coveredFrom) {
    const deploy = Number(index.deployBlock);
    const top = Number(index.finalizedTo);
    if (top >= deploy) ratio = (top - Number(index.coveredFrom) + 1) / (top - deploy + 1);
  }
  const percent =
    ratio === null || !Number.isFinite(ratio)
      ? null
      : Math.min(99, Math.max(0, Math.floor(ratio * 100)));
  return { indexing: true, percent };
}

/**
 * "Indexing 37%" ("Indexing log history · 37%" with a subject), or "Indexing…" while there is no
 * measure or it is still under 1%: an indexing state never shows a 0 that could be read as a count.
 */
export function indexingLabel(progress: IndexProgress, subject?: string): string {
  const what = subject ? `Indexing ${subject}` : "Indexing";
  if (!progress.percent) return `${what}…`;
  return subject ? `${what} · ${progress.percent}%` : `${what} ${progress.percent}%`;
}

const IndexProgressContext = createContext<IndexProgress>(NOT_INDEXING);

/** The live backfill progress (not indexing outside the app shell). */
export function useIndexProgress(): IndexProgress {
  return useContext(IndexProgressContext);
}

const POLL_MS = 2_000;
// About 5 minutes of polling; after that the label keeps its last value until Refresh.
const MAX_POLLS = 150;

/** Not settled yet: the backfill has not started (e.g. right after a settings save) or runs. */
const unsettled = (index: IndexStatusView) =>
  index.state === "idle" || index.state === "backfilling";

/**
 * Provides the index progress from the root status, and while the index is not settled (idle or
 * backfilling) polls /api/status for fresher progress (only then: an idle tab must not poll
 * forever; the server does not count these reads as a visit either). A failed poll keeps the last
 * value.
 *
 * `onSettled` runs once when a poll finds the index ready or unavailable. The root status is not
 * read again on its own, and it holds what the finished index changes: the log-history check
 * against the index (no opinion until it is ready) behind the "Your RPC may not serve old logs"
 * banner, warnings and `sync.index`. The app shell reads the root status again there.
 */
export function IndexProgressProvider({
  initial,
  onSettled,
  children,
}: {
  initial: IndexStatusView;
  onSettled?: () => void;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(initial);
  const [polls, setPolls] = useState(0);
  // A newer root status (Refresh, settings) replaces whatever polling found, and late answers
  // to polls sent before it are dropped.
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current += 1;
    setIndex(initial);
    setPolls(0);
  }, [initial]);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  const progress = useMemo(() => indexProgress(index), [index]);
  const polling = unsettled(index);
  useEffect(() => {
    if (!polling || polls >= MAX_POLLS) return;
    const sent = epoch.current;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch($path("/api/status"), {
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as Partial<OkStatus> | null;
        if (!cancelled && sent === epoch.current && body?.ok && body.sync?.index) {
          const next = body.sync.index;
          setIndex(next);
          // Polling stops here (the index is settled), so this runs once per root status.
          if (!unsettled(next)) settled.current?.();
        }
      } catch {
        // Keep the last known progress; the next poll tries again.
      }
      if (!cancelled) setPolls((n) => n + 1);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, polls]);

  return <IndexProgressContext.Provider value={progress}>{children}</IndexProgressContext.Provider>;
}

/**
 * The header's indexing state; nothing once the index is ready. Below `sm` only the spinner and
 * the share show (the word stays for screen readers), so the header fits a phone.
 */
export function IndexingPill() {
  const progress = useIndexProgress();
  if (!progress.indexing) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-2 font-semibold text-amber-950 text-xs"
      title="Reading the upgrade handler's log history. Lists wait until the range they show is covered and are never shown from part of it."
      data-testid="index-progress"
    >
      <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
      <span>
        <span className="sr-only sm:not-sr-only">
          {progress.percent ? "Indexing " : "Indexing"}
        </span>
        {progress.percent ? `${progress.percent}%` : "…"}
      </span>
    </span>
  );
}

/** Unix seconds by this browser's clock, once a second; null on the server and before mount. */
export function useNowSeconds(intervalMs = 1_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * "block #N · 12s ago". The age needs the browser's clock, so the server (and hydration) render
 * only the block; the block number is hidden on narrow screens, the age is not.
 */
export function BlockAge({
  block,
  className,
}: {
  block: { number: string; timestamp: string };
  className?: string;
}) {
  const now = useNowSeconds();
  const age = now === null ? null : formatAge(now - Number(block.timestamp));
  return (
    <span
      className={cn("font-mono text-slate-700", className)}
      title={`Block ${block.number}, mined ${formatTime(block.timestamp)}, read through your RPC. Refresh to read a newer one.`}
      data-testid="block-age"
    >
      <span className="hidden lg:inline">block #{formatNumber(block.number)}</span>
      {age && (
        <>
          <span className="hidden lg:inline"> · </span>
          {age}
        </>
      )}
    </span>
  );
}

/**
 * A list's loading state. While the index backfills it says so (with progress), and never a
 * count: a list is only shown once the range it covers is complete.
 */
export function IndexedLoadingCard({ label }: { label: string }) {
  const progress = useIndexProgress();
  if (!progress.indexing) return <LoadingCard label={label} />;
  const share = progress.percent ? ` (${progress.percent}%)` : "";
  return (
    <LoadingCard
      label={`${label} Indexing the upgrade handler's log history${share}; the list appears once its range is covered.`}
    />
  );
}
