import { useLive } from "@/components/presence";
import { formatNumber } from "@/utils/format";
import { Clock } from "lucide-react";
import { createContext, useContext } from "react";

// Whether what a page shows was read again at the head the app serves now. Every item a page
// shows (the root status, an upgrade's state, a list, a transaction's receipt) has a key the tab
// beats with; the beat names, for each item whose content the tab shows is the current one, the
// newest head that content was noted at (`notedAt`: read there, or read again there with the same
// result). An item named at a block before the served head was not read there (its reads failed,
// or what it needs is not in memory): it is shown as of that block, in no passing colour, and
// nothing on its page is signed or sent from it, until it is read again. Signature sets and
// simulations say the same through their own beats' fields (freshness.tsx, execution-panel.tsx).

type Live = {
  head: { number: string } | null;
  notedAt?: Record<string, { rev: string; block: string }>;
};

/**
 * The newest block the beats name for the item under `key` (null when they name none: before the
 * first beat, on a dev node, for content the tab no longer shows, a reload being on its way), and
 * the head served now when that block is before it (`behind`), else null.
 */
export function contentCurrency(
  key: string | null | undefined,
  live: Live
): { block: string | null; behind: string | null } {
  const noted = key ? live.notedAt?.[key] : undefined;
  if (!noted) return { block: null, behind: null };
  const served = live.head?.number ?? null;
  return {
    block: noted.block,
    behind: served !== null && BigInt(served) > BigInt(noted.block) ? served : null,
  };
}

/** contentCurrency for the item under `key`, from the tab's beats. */
export function useContentCurrency(key: string | null | undefined) {
  return contentCurrency(key, useLive());
}

/** "As of block #N · not re-read at #M". */
export function notReReadHeadline(block: string, behind: string): string {
  return `As of block #${formatNumber(block)} · not re-read at #${formatNumber(behind)}`;
}

/**
 * The notice for an item not read again at the head served now (see contentCurrency): its block
 * first, then what it speaks for. Nothing while the item is current.
 */
export function NotReReadNote({
  watchKey,
  what,
}: {
  watchKey: string;
  /** What the notice speaks for ("The state and timeline below"). */
  what: string;
}) {
  const { block, behind } = useContentCurrency(watchKey);
  if (block === null || behind === null) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
      data-testid="not-reread"
      data-stale="true"
    >
      <Clock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold">{notReReadHeadline(block, behind)}</span>
        <span className="block text-xs">
          {what} are as of that block, not the current state. They are read again at each new block
          and update here once that succeeds.
        </span>
      </span>
    </div>
  );
}

/** Why nothing on a page may be signed or sent now, and what it waits for. */
export type NotCurrent = { reason: string; waits: string };

const PageCurrencyContext = createContext<NotCurrent | null>(null);

/**
 * Around a page whose main item (an upgrade's state) may be behind the head served: while it is
 * (see contentCurrency), its Sign and Send buttons say why and wait.
 */
export function PageCurrency({
  watchKey,
  what,
  children,
}: {
  watchKey: string;
  /** What was not read ("The upgrade's state"). */
  what: string;
  children: React.ReactNode;
}) {
  const { behind } = useContentCurrency(watchKey);
  const value =
    behind === null
      ? null
      : {
          reason: `${what} was not read at block #${formatNumber(behind)} yet.`,
          waits: "Sending waits until it is read at the current block.",
        };
  return <PageCurrencyContext.Provider value={value}>{children}</PageCurrencyContext.Provider>;
}

/** Why this page's main item keeps its Sign and Send buttons waiting (see PageCurrency), or null. */
export function usePageNotCurrent(): NotCurrent | null {
  return useContext(PageCurrencyContext);
}
