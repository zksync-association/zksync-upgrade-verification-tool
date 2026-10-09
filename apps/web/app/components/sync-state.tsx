import type { OkStatus } from "@/components/governance-context";
import { LoadingCard } from "@/components/page";
import { useLive } from "@/components/presence";
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

// The root status is not read again on every navigation (utils/revalidation.ts), so the block's
// age keeps growing until it is.

export type IndexStatusView = OkStatus["sync"]["index"];

export type IndexProgress = { indexing: boolean; percent: number | null };

const NOT_INDEXING: IndexProgress = { indexing: false, percent: null };

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

// "Indexing…" without a measure or under 1%: never a 0 that could be read as a count.
export function indexingLabel(progress: IndexProgress, subject?: string): string {
  const what = subject ? `Indexing ${subject}` : "Indexing";
  if (!progress.percent) return `${what}…`;
  return subject ? `${what} · ${progress.percent}%` : `${what} ${progress.percent}%`;
}

type ProgressState = { progress: IndexProgress; known: boolean };

const IndexProgressContext = createContext<ProgressState>({
  progress: NOT_INDEXING,
  known: false,
});

export function useIndexProgress(): IndexProgress {
  return useContext(IndexProgressContext).progress;
}

const unsettled = (index: IndexStatusView) =>
  index.state === "idle" || index.state === "backfilling";

// Progress from the root status (`initial`), then from the tab's beats: no request of its own.
// `onSettled` runs once when a beat finds the index settled after it was not: the root status holds
// what the finished index changes (the log-history check behind the old-logs banner, warnings).
export function IndexProgressProvider({
  initial,
  onSettled,
  children,
}: {
  initial: IndexStatusView | null;
  onSettled?: () => void;
  children: ReactNode;
}) {
  const beat = useLive().index as IndexStatusView | null;
  const [index, setIndex] = useState(initial);
  // A newer root status (Refresh, settings) replaces whatever the beats said.
  useEffect(() => {
    setIndex(initial);
  }, [initial]);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);
  const shown = useRef(index);
  shown.current = index;
  useEffect(() => {
    if (!beat) return;
    const before = shown.current;
    setIndex(beat);
    if (before && unsettled(before) && !unsettled(beat)) settled.current?.();
  }, [beat]);

  const value = useMemo(() => ({ progress: indexProgress(index), known: index !== null }), [index]);
  return <IndexProgressContext.Provider value={value}>{children}</IndexProgressContext.Provider>;
}

// `fallback`: the shown status's index, until the provider has its own (on the server, before the
// status lands). Below `sm` only the spinner and share show (the word stays for screen readers).
export function IndexingPill({ fallback }: { fallback?: IndexStatusView | null }) {
  const live = useContext(IndexProgressContext);
  const progress = live.known ? live.progress : indexProgress(fallback);
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

// The age needs the browser's clock: the server (and hydration) render only the block. The number
// is hidden below 2xl, where the header's links would not fit beside it.
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
      <span className="hidden 2xl:inline">block #{formatNumber(block.number)}</span>
      {age && (
        <>
          <span className="hidden 2xl:inline"> · </span>
          {age}
        </>
      )}
    </span>
  );
}

// While the index backfills, never a count: a list is only shown once its range is complete.
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
