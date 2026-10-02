import { CopyButton } from "@/components/hex";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { Link } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  back,
  eyebrow,
  title,
  badges,
  id,
  actions,
  children,
}: {
  back?: { to: string; label: string };
  eyebrow?: string;
  title: ReactNode;
  badges?: ReactNode;
  id?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 space-y-3">
      {back && (
        <Link
          to={back.to}
          className="inline-flex items-center gap-1.5 text-slate-600 text-sm hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {eyebrow && (
            <p className="font-semibold text-[11px] text-slate-600 uppercase tracking-[0.08em]">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[32px] leading-10 tracking-[-0.02em]">{title}</h1>
            {badges}
          </div>
          {id && (
            <p className="flex items-center gap-1">
              <span className="mono break-all text-slate-700" data-testid="page-id">
                {id}
              </span>
              <CopyButton value={id} label="Copy id" />
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  className,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[22px] leading-7 tracking-[-0.01em]">{title}</h2>
          {description && <p className="max-w-3xl text-slate-950 text-sm">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs in a white card. */
export function Facts({
  items,
  className,
}: { items: { label: string; value: ReactNode; testId?: string }[]; className?: string }) {
  return (
    <Card className={cn("p-6", className)}>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 space-y-1" data-testid={item.testId}>
            <dt className="text-slate-600 text-xs">{item.label}</dt>
            <dd className="min-w-0 text-slate-950 text-sm">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5 text-sm",
        ok === true && "text-green-700",
        ok === false && "text-red-700",
        ok === null && "text-slate-600"
      )}
    >
      <span aria-hidden className="mt-px font-semibold">
        {ok === true ? "✓" : ok === false ? "✗" : "–"}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 border-dashed bg-white px-6 py-10 text-center text-slate-600 text-sm">
      {children}
    </div>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card className="flex items-center gap-3 px-6 py-8 text-slate-600 text-sm">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-navy-800" />
      {label}
    </Card>
  );
}
