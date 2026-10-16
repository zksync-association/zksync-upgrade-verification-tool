import { CopyButton } from "@/components/hex";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { Link } from "@remix-run/react";
import { AlertTriangle, ArrowLeft, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  back,
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
    <div className="mb-6 space-y-2">
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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-semibold text-2xl leading-8 tracking-tight">{title}</h1>
            {badges}
          </div>
          {id && (
            <p className="flex max-w-full items-start gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3">
              <span
                className="mono min-w-0 break-all font-medium text-navy-800"
                data-testid="page-id"
              >
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
          <h2 className="font-semibold text-lg">{title}</h2>
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
    <Card className={cn("p-5 sm:p-6", className)}>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-0 space-y-2 border-slate-200 border-b pb-3"
            data-testid={item.testId}
          >
            <dt className="font-medium text-slate-600 text-xs">{item.label}</dt>
            <dd className="min-w-0 font-medium text-slate-950 text-sm">{item.value}</dd>
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
        "inline-flex items-start gap-1.5 rounded-md px-2 py-1 font-semibold text-sm",
        ok === true && "bg-green-100 text-green-900",
        ok === false && "bg-red-100 text-red-900",
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

/** An empty list, said in one quiet line: complete (a check) or from incomplete sources (a warning). */
export function QuietEmpty({
  children,
  incomplete = false,
}: { children: ReactNode; incomplete?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-xl px-4 py-3 text-[14px]",
        incomplete ? "bg-amber-50 text-amber-950" : "bg-slate-75 text-slate-700"
      )}
    >
      {incomplete ? (
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-amber-700" />
      ) : (
        <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-slate-550" />
      )}
      {children}
    </p>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card className="space-y-3 px-6 py-6 text-slate-700 text-sm">
      <p role="status">{label}</p>
      <div aria-hidden className="space-y-2 motion-safe:animate-pulse">
        <div className="h-3 w-3/4 rounded bg-slate-100" />
        <div className="h-3 w-1/2 rounded bg-slate-100" />
      </div>
    </Card>
  );
}
