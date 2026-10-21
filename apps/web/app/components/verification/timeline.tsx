import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

export type TimelineStep = {
  label: string;
  at: number | null;
  done: boolean;
  current?: boolean;
  failed?: boolean;
  /** In place of the time under the label (a time that arrives later, e.g. the execution's). */
  time?: ReactNode;
};

/** A step's time: the date stays in view, how long ago (or until) on hover. */
export function StepTime({ at, now }: { at: number; now: number }) {
  return (
    <p className="text-slate-500 text-xs" title={relativeTime(at, now)}>
      {formatTime(at)}
    </p>
  );
}

/**
 * Vertical stepper; times are on-chain timestamps, "now" is the latest block's. The last step is
 * the outcome: green once done. Its height follows its steps (never stretched beside a card).
 */
export function Timeline({ steps, now }: { steps: TimelineStep[]; now: number }) {
  return (
    <Card className="self-start border-slate-200 px-5 py-5">
      <ol>
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={step.label} className="relative flex gap-3 pb-3.5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-6 left-[11px] h-[calc(100%-20px)] w-px",
                    step.done ? "bg-slate-300" : "bg-slate-200"
                  )}
                />
              )}
              <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full border",
                    last ? "h-6 w-6" : "h-5 w-5",
                    step.failed && "border-red-200 bg-red-50 text-red-800",
                    !step.failed && step.done && last && "border-green-700 bg-green-700 text-white",
                    !step.failed && step.done && !last && "border-navy-800 bg-navy-800 text-white",
                    !step.failed &&
                      !step.done &&
                      step.current &&
                      "border-brand-600 bg-brand-50 text-brand-600",
                    !step.failed &&
                      !step.done &&
                      !step.current &&
                      "border-slate-200 bg-white text-slate-500"
                  )}
                >
                  {step.failed ? (
                    <X className={last ? "h-3.5 w-3.5" : "h-3 w-3"} />
                  ) : step.done ? (
                    <Check className={last ? "h-3.5 w-3.5" : "h-3 w-3"} />
                  ) : (
                    <span className="text-[11px]">{i + 1}</span>
                  )}
                </span>
              </span>
              <div className="min-w-0 pt-0.5">
                <p
                  className={cn(
                    "text-sm",
                    step.current || (last && step.done) ? "font-semibold" : "font-medium",
                    last && step.done ? "text-green-900" : "text-slate-950"
                  )}
                >
                  {step.label}
                </p>
                {step.time ?? (step.at !== null && <StepTime at={step.at} now={now} />)}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
