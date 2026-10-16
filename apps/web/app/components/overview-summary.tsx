import { useNowSeconds } from "@/components/sync-state";
import { type Refresh, copiesAge } from "@/components/verification/freshness";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import { AlertTriangle, CircleDot, Clock, Inbox, Link2, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// Where a count's first answer came from when it is not fresh (the last run's history, Safe copies
// older than 60 s, or as last shown at `asOfBlock` after a pause); null for a fresh count.
export type SummarySource = {
  lastRun: boolean;
  safeFetchedAt: string | null;
  asOfBlock?: string | null;
} | null;

/** What a non-zero current count asks of the reader: a signature or a look (orange), or a process
 * that is running (blue). */
export type SummaryTone = "attention" | "active";

/**
 * Where a count comes from: the governance contracts' state read on chain, or signatures collected
 * in the Safe Transaction Service (each still checked on chain on its own page).
 */
export type CountedFrom = "chain" | "safe";

const COUNTED_FROM = {
  chain: {
    icon: Link2,
    text: "On-chain",
    title: "Counted from the governance contracts' state, read through your RPC.",
  },
  safe: {
    icon: Inbox,
    text: "In Safe",
    title:
      "Counted from signatures collected in the Safe Transaction Service. Each one is checked on chain on its page before it counts.",
  },
} as const;

// Every status starts at the column's edge: a chip's border, or plain text where there is none.
const chipTone = {
  attention:
    "rounded-full border border-orange-400 bg-orange-100 px-2.5 font-semibold text-orange-950",
  active: "rounded-full border border-brand-200 bg-brand-25 px-2.5 font-semibold text-navy-800",
  // Nothing open: plain text, quieter than anything that needs a look, never greyed out.
  none: "font-normal text-slate-550",
  // Older data (as last shown, the last run's history, old Safe copies): dashed, never coloured.
  held: "rounded-full border border-slate-400 border-dashed bg-white px-2.5 font-semibold text-navy-800",
};

/**
 * Discovery failures must not look like a complete, empty proposal list. `emphasize`: the count is
 * current, so a non-zero one takes its tone; a count from older data never does. Every state says
 * itself in words and an icon or border as well as a colour, and where the count comes from.
 */
export function OverviewSummary({
  count,
  label,
  detail,
  incomplete = false,
  note,
  emphasize = false,
  tone = "attention",
  from,
}: {
  count: number;
  label: string;
  detail?: string;
  incomplete?: boolean;
  note?: ReactNode;
  emphasize?: boolean;
  tone?: SummaryTone;
  from?: CountedFrom;
}) {
  const state = !emphasize ? "held" : count > 0 ? tone : "none";
  const Icon = state === "attention" ? Clock : state === "active" ? CircleDot : null;
  const source = from ? COUNTED_FROM[from] : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-3">
      <div className="min-w-0">
        {incomplete ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-amber-400 bg-amber-50 px-2.5 font-semibold text-[14px] text-amber-950">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" /> List incomplete
          </span>
        ) : (
          <p
            className={cn("inline-flex h-6 items-center gap-1.5 text-[14px]", chipTone[state])}
            data-testid="count-chip"
            data-tone={state}
            data-highlight={state === "attention" || state === "active" ? "true" : undefined}
          >
            {Icon && <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />}
            <span className="tabular-nums">{count}</span> {label}
          </p>
        )}
      </div>
      {source ? (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-slate-550"
          title={source.title}
          data-testid="counted-from"
        >
          <source.icon aria-hidden className="h-3 w-3 shrink-0" />
          {source.text}
        </span>
      ) : (
        <span />
      )}
      <div className="col-span-2">
        {incomplete && (
          <p className="text-slate-700 text-xs">{count} found · some sources could not be read</p>
        )}
        {detail && <p className="text-slate-550 text-xs">{detail}</p>}
        {note}
      </div>
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
