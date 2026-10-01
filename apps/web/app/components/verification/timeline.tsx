import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";
import { Check, X } from "lucide-react";

export type TimelineStep = {
  label: string;
  at: number | null;
  done: boolean;
  current?: boolean;
  failed?: boolean;
};

/** Vertical stepper; times are on-chain timestamps, "now" is the latest block's. */
export function Timeline({ steps, now }: { steps: TimelineStep[]; now: number }) {
  return (
    <Card className="p-6">
      <ol className="space-y-0">
        {steps.map((step, i) => (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-6 left-[11px] h-[calc(100%-16px)] w-px",
                  step.done ? "bg-navy-800" : "bg-slate-200"
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                step.failed && "border-red-200 bg-red-50 text-red-700",
                !step.failed && step.done && "border-navy-800 bg-navy-800 text-white",
                !step.failed &&
                  !step.done &&
                  step.current &&
                  "border-brand-600 bg-brand-50 text-brand-600",
                !step.failed &&
                  !step.done &&
                  !step.current &&
                  "border-slate-200 bg-white text-slate-400"
              )}
            >
              {step.failed ? (
                <X className="h-3.5 w-3.5" />
              ) : step.done ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  "text-sm",
                  step.current ? "font-semibold text-slate-950" : "text-slate-950"
                )}
              >
                {step.label}
              </p>
              {step.at !== null && (
                <p className="text-slate-600 text-xs">
                  {formatTime(step.at)} · {relativeTime(step.at, now)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
