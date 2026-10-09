import { AlertTriangle } from "lucide-react";

/** Discovery failures must not look like a complete, empty proposal list. */
export function OverviewSummary({
  count,
  label,
  detail,
  incomplete = false,
}: {
  count: number;
  label: string;
  detail?: string;
  incomplete?: boolean;
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
    </div>
  );
}
