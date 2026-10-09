import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { Link, useNavigation } from "@remix-run/react";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// A list's "full history" / "recent only" switch. The router keeps the current list on screen
// until the other one has loaded (it waits for deferred data of a route it revalidates), so
// without feedback the click looks dead; this shows it is loading.

/** True while a navigation to exactly `to` (path and search) is in flight. */
export function useNavigatingTo(to: string): boolean {
  const navigation = useNavigation();
  if (navigation.state === "idle") return false;
  const target = new URL(to, "http://app.invalid");
  return (
    navigation.location.pathname === target.pathname && navigation.location.search === target.search
  );
}

export function HistoryToggle({
  to,
  children,
  pendingLabel,
  variant = "link",
}: {
  to: string;
  children: ReactNode;
  /** Shown, with a spinner, while the other list loads. */
  pendingLabel: string;
  variant?: "link" | "button";
}) {
  const pending = useNavigatingTo(to);
  const content = pending ? (
    <span role="status" className="inline-flex items-center gap-1.5">
      <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
      {pendingLabel}
    </span>
  ) : (
    children
  );
  if (variant === "button") {
    return (
      <Button variant="secondary" size="sm" asChild>
        <Link to={to} aria-busy={pending || undefined} data-testid="history-toggle">
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Link
      className={cn("text-brand-600 hover:underline", pending && "cursor-progress")}
      to={to}
      aria-busy={pending || undefined}
      data-testid="history-toggle"
    >
      {content}
    </Link>
  );
}

/** Dims a list while the other history range loads in its place. */
export function PendingRegion({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <div
      aria-busy={pending || undefined}
      className={cn("transition-opacity", pending && "opacity-60")}
    >
      {children}
    </div>
  );
}
