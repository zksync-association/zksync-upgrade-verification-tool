import { useNowSeconds } from "@/components/sync-state";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { type Refresh, copiesAge } from "./freshness";

// Shown first after a pause: what pages last showed, as of its block, until the current answer
// replaces it. Said first, in no colour, and nothing in it can be signed or sent.
export type AsOfBlock = { block: string; timestamp: string };

export function asOfHeadline(asOf: AsOfBlock, refresh: Refresh): string {
  const at = `As of block #${formatNumber(asOf.block)}`;
  return refresh === "pending" ? `${at} · reading the newest block` : at;
}

function blockAge(asOf: AsOfBlock, nowSeconds: number | null): string {
  const seconds = Number(asOf.timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return "at an unknown time";
  return copiesAge(new Date(seconds * 1000).toISOString(), nowSeconds);
}

export function AsOfNote({
  asOf,
  refresh,
  what,
}: {
  asOf: AsOfBlock;
  refresh: Refresh;
  what: string;
}) {
  const now = useNowSeconds();
  const failed = refresh === "failed";
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
      data-testid="as-of"
      data-stale="true"
    >
      {failed ? (
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Loader2
          aria-hidden
          className={`mt-0.5 h-4 w-4 shrink-0${refresh === "pending" ? " motion-safe:animate-spin" : ""}`}
        />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold">{asOfHeadline(asOf, refresh)}</span>
        <span className="block text-xs">
          {what} are as this app last showed them, read at that block ({blockAge(asOf, now)}), not
          the current state.
          {refresh === "pending" && " The current state replaces them when it arrives."}
        </span>
        {failed && (
          <span className="block font-medium">
            Reading the newest block did not complete. Refresh the page to retry.
          </span>
        )}
      </span>
    </div>
  );
}

// Content as of an older block in no colour, so no badge, check or bar in it reads as a current
// pass. The same element either way.
export function AsOfContent({
  asOf,
  stale = false,
  className,
  children,
}: {
  asOf: AsOfBlock | null | undefined;
  stale?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dim = !!asOf || stale;
  return (
    <div className={cn(className, dim && "grayscale")} data-stale={dim ? "true" : undefined}>
      {children}
    </div>
  );
}
