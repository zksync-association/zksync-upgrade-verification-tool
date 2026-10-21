import { useLive } from "@/components/presence";
import { formatNumber } from "@/utils/format";
import { Clock } from "lucide-react";
import { createContext, useContext } from "react";

// Whether what a page shows was read again at the head the app serves now. An item the beats name
// at an older block is shown as of that block, in no passing colour, and nothing on its page is
// signed or sent from it, until the tab shows content read at the served head.

type Live = {
  head: { number: string } | null;
  notedAt?: Record<string, { rev: string; block: string }>;
};

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

export function useContentCurrency(key: string | null | undefined) {
  return contentCurrency(key, useLive());
}

export function notReReadHeadline(block: string, behind: string): string {
  return `As of block #${formatNumber(block)} · not re-read at #${formatNumber(behind)}`;
}

export function NotReReadNote({
  watchKey,
  what,
}: {
  watchKey: string;
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

// While the page's main item (an upgrade's state) is behind the head served, its Sign and Send
// buttons say why and wait.
export function PageCurrency({
  watchKey,
  what,
  children,
}: {
  watchKey: string;
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

export function usePageNotCurrent(): NotCurrent | null {
  return useContext(PageCurrencyContext);
}
