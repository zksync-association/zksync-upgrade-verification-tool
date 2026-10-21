import { useStatusIfRead } from "@/components/governance-context";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";

/**
 * When a transaction was executed, from its block's time: "Oct 20, 2026, 14:05 UTC", how long ago
 * on hover (relative to the newest block read, so the server and the browser render the same
 * text). Nothing when the time could not be read.
 */
export function ExecutedOn({
  at,
  className,
}: {
  at: string | null | undefined;
  className?: string;
}) {
  const now = useStatusIfRead()?.governance.latestBlock?.timestamp;
  if (!at) return null;
  return (
    <span
      className={cn("block text-[13px] text-slate-600", className)}
      title={now ? relativeTime(at, now) : undefined}
      data-testid="executed-on"
    >
      {formatTime(at)}
    </span>
  );
}
