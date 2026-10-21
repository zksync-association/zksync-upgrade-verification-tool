import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

/** A table's controls as one segmented group (Expand all · Show types · Raw). */
export function Toolbar({
  children,
  label,
  className,
}: { children: ReactNode; label?: string; className?: string }) {
  return (
    <span
      role="toolbar"
      aria-label={label}
      className={cn(
        "inline-flex items-stretch divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white",
        className
      )}
    >
      {children}
    </span>
  );
}

/** One control in a Toolbar: pressed while its view is on. */
export function ToolButton({
  children,
  onClick,
  pressed,
}: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 px-3 font-medium text-[13px] transition-colors focus-visible:relative focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-600/20",
        pressed
          ? "bg-navy-50 text-navy-800"
          : "text-slate-700 hover:bg-slate-75 hover:text-slate-950"
      )}
    >
      {children}
    </button>
  );
}
