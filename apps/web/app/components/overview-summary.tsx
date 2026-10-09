import { useNowSeconds } from "@/components/sync-state";
import { type Refresh, copiesAge } from "@/components/verification/freshness";
import { formatNumber } from "@/utils/format";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// Where a count's first answer came from when it is not fresh (the last run's history, Safe copies
// older than 60 s, or as last shown at `asOfBlock` after a pause); null for a fresh count.
export type SummarySource = {
  lastRun: boolean;
  safeFetchedAt: string | null;
  asOfBlock?: string | null;
} | null;

/** Discovery failures must not look like a complete, empty proposal list. */
export function OverviewSummary({
  count,
  label,
  detail,
  incomplete = false,
  note,
}: {
  count: number;
  label: string;
  detail?: string;
  incomplete?: boolean;
  note?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {incomplete ? (
        <>
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-900 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" /> List incomplete
          </span>
          <p className="text-slate-700 text-xs">{count} found · some sources could not be read</p>
        </>
      ) : (
        <p className="font-semibold text-base text-navy-800">
          <span className="tabular-nums">{count}</span> {label}
        </p>
      )}
      {detail && <p className="text-slate-600 text-xs">{detail}</p>}
      {note}
    </div>
  );
}

export function SummaryNote({ source, refresh }: { source: SummarySource; refresh: Refresh }) {
  const now = useNowSeconds();
  if (!source) return null;
  const parts = [
    source.asOfBlock ? `As of block #${formatNumber(source.asOfBlock)}` : null,
    source.lastRun ? "History from last run" : null,
    source.safeFetchedAt ? `Safe copies from ${copiesAge(source.safeFetchedAt, now)}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const failed = refresh === "failed";
  return (
    <p
      className="inline-flex items-start gap-1 font-medium text-amber-900 text-xs"
      data-testid="summary-note"
    >
      {failed ? (
        <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2
          aria-hidden
          className={`mt-px h-3.5 w-3.5 shrink-0${refresh === "pending" ? " motion-safe:animate-spin" : ""}`}
        />
      )}
      <span>
        {parts.join(" · ")} ·{" "}
        <span className="whitespace-nowrap">
          {failed ? "checking again did not complete" : "re-verifying"}
        </span>
      </span>
    </p>
  );
}
