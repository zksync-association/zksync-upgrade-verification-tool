import type { SafeCheck } from "@/.server/safe/store";
import { useLive } from "@/components/presence";
import { useNowSeconds } from "@/components/sync-state";
import { formatAge, formatNumber, formatTime } from "@/utils/format";
import { AlertTriangle, Loader2 } from "lucide-react";

// Where a signature set's data came from and how old it is. Every set says the block its verdicts
// were read at and when Safe's copies were read. A page's first answer may be stale (`stale`: an
// older block's verdicts, or Safe copies older than 60 s, see .server/signatures.ts
// firstSignatureSet); it says so prominently until the fresh result replaces it.

/**
 * Where the fresh result is, for a stale first answer on screen: "pending" while it streams in,
 * "failed" when it could not be computed (the first answer then stays, saying so). "behind": a
 * set's result the app did not verify again at the head it serves now (`reverifyingAt`, see
 * setCurrency): it is shown as of its block until a result at a newer head replaces it. null
 * otherwise.
 */
export type Refresh = "pending" | "failed" | "behind" | null;

/** What a set (or list) says about its own freshness (see SignatureSet). */
export type Labelled = {
  verifiedAtBlock?: string | null;
  safeFetchedAt?: string | null;
  stale?: boolean;
  reverifyingAt?: string | null;
};

/**
 * How old a Safe copy is: "12s ago" by this browser's clock, or the time it was read until that
 * clock is known (the server render and hydration must match).
 */
export function copiesAge(fetchedAt: string, nowSeconds: number | null): string {
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return "an unknown time";
  return nowSeconds === null ? formatTime(fetchedAt) : formatAge(nowSeconds - ms / 1000);
}

/**
 * The labels: "Verified at block #N" (+ " · re-verifying at #M" while the fresh result is
 * pending, " · not re-verified at #M" for a result behind the head served), "Safe copies from 12s
 * ago" (+ " · refreshing"), and a line when re-verification failed. null for a label the set has
 * nothing for (a dev node's 'latest', no Safe copy read).
 */
export function freshnessLabels(set: Labelled, refresh: Refresh, nowSeconds: number | null) {
  const block = set.verifiedAtBlock ?? null;
  const at =
    set.reverifyingAt && set.reverifyingAt !== block
      ? ` at #${formatNumber(set.reverifyingAt)}`
      : "";
  const pending = refresh === "pending";
  const behind = refresh === "behind" && at !== "" ? ` · not re-verified${at}` : "";
  return {
    verified:
      block === null
        ? null
        : `Verified at block #${formatNumber(block)}${pending ? ` · re-verifying${at}` : behind}`,
    copies: set.safeFetchedAt
      ? `Safe copies from ${copiesAge(set.safeFetchedAt, nowSeconds)}${pending ? " · refreshing" : ""}`
      : null,
    failed:
      refresh === "failed" ? "Checking again did not complete. Refresh the page to retry." : null,
  };
}

/** What a set says about the block it was verified at, and the key it is followed under. */
export type Followed = Pick<Labelled, "verifiedAtBlock" | "stale"> & {
  watch?: { key: string; rev: string | null } | null;
};

/**
 * Whether a set's verdicts are current: the newest block the content shown was verified at (the
 * block it loaded with, or a newer one the beats name for that content, `verifiedAt`, read again
 * there with the same result), and, when that is before the head the app serves now (`head`),
 * that head: the set was not verified there (its reads failed, it needs Safe, or the check has
 * not run yet; a page with a signature from its URL is never followed), so it is shown as of its
 * block, in no passing colour and with nothing to sign or send, until a result at a newer head
 * replaces it. Never behind before the first beat, on a dev node ('latest': no block), or for a
 * stale first answer (it says so itself).
 */
export function setCurrency(
  set: Followed,
  live: {
    head: { number: string } | null;
    verifiedAt?: Record<string, { rev: string; block: string }>;
  }
): { block: string | null; behind: string | null } {
  const at = set.verifiedAtBlock ?? null;
  if (at === null) return { block: null, behind: null };
  const watch = set.watch ?? null;
  const again = watch && watch.rev !== null ? live.verifiedAt?.[watch.key] : undefined;
  const block =
    again && again.rev === watch?.rev && BigInt(again.block) > BigInt(at) ? again.block : at;
  const served = live.head?.number ?? null;
  const behind = !set.stale && served !== null && BigInt(served) > BigInt(block) ? served : null;
  return { block, behind };
}

/**
 * "ZKsync Era block #E · read 12s ago": the Era head what is shown was read at: the one the page
 * loaded at (`fallback`), or a newer one the beats name for this item (`watchKey`) while its
 * content is unchanged (read again there with the same result). Never a head whose read failed:
 * then the age just grows. Era is read about once a minute while such a page is on screen.
 */
export function EraBlockNote({
  watchKey,
  fallback = null,
}: { watchKey: string; fallback?: { number: string; readAt: string } | null }) {
  const live = useLive().eraAt?.[watchKey] ?? null;
  const now = useNowSeconds();
  const era =
    live && (!fallback || BigInt(live.number) > BigInt(fallback.number)) ? live : fallback;
  if (!era) return null;
  return (
    <p className="text-slate-600 text-xs" data-testid="era-block">
      ZKsync Era block #{formatNumber(era.number)} · read {copiesAge(era.readAt, now)}
    </p>
  );
}

const PAUSED: Record<string, string> = {
  quota: "checks paused (Safe quota low)",
  budget: "checks paused (hourly budget used)",
  cooldown: "checks paused (Safe rate limit)",
  "quota-exhausted": "checks paused (Safe's monthly quota used up)",
};

/**
 * How the Safe copies of a set's members not valid yet are kept: "Safe checked 12s ago · next
 * check in 48s", "· checking now", "· checks paused (…)", "· only on request (no Safe key)". The
 * ages need this browser's clock: until it is known, the time the copy was confirmed. While this
 * tab's updates are paused (away, or the app not answering), nothing is checked for it: said so,
 * never a countdown.
 */
export function safeCheckLabel(
  check: SafeCheck,
  nowSeconds: number | null,
  updatesPaused = false
): string {
  const checked = check.checkedAt
    ? `Safe checked ${copiesAge(check.checkedAt, nowSeconds)}`
    : "Safe not checked yet";
  if (updatesPaused && check.state !== "on-request" && check.state !== "off")
    return `${checked} · checks paused (updates paused)`;
  switch (check.state) {
    case "watching": {
      if (!check.nextAt || nowSeconds === null) return checked;
      const left = Math.round(Date.parse(check.nextAt) / 1000 - nowSeconds);
      return left <= 0
        ? `${checked} · checking now`
        : `${checked} · next check in ${formatAge(left).replace(/ ago$/, "")}`;
    }
    case "paused":
      return `${checked} · ${PAUSED[check.reason ?? ""] ?? "checks paused"}`;
    case "on-request":
      return `${checked} · only on request (no Safe key)`;
    default:
      return checked;
  }
}

/**
 * Of two reports of how the same Safe copies are kept (the last beat's, and the page's own from
 * its last load or a Fetch signatures answer), the newer: the one whose Safes were checked more
 * recently, so the label never shows a check older than the result next to it.
 */
export function newerCheck(
  a: SafeCheck | null | undefined,
  b: SafeCheck | null | undefined
): SafeCheck | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const at = (check: SafeCheck) =>
    check.checkedAt ? Date.parse(check.checkedAt) : Number.NEGATIVE_INFINITY;
  return at(b) > at(a) ? b : a;
}

/**
 * A set's freshness: one quiet line for a fresh result; for a stale first answer, a notice that
 * names its block first, so no status below reads as a current pass. `check`: how the copies of
 * members not valid yet are kept (an open set), said in place of the copies' age.
 */
export function FreshnessNote({
  set,
  refresh = null,
  what = "Statuses below",
  check = null,
  followed = true,
}: {
  set: Labelled;
  refresh?: Refresh;
  /** What the notice speaks for. */
  what?: string;
  check?: SafeCheck | null;
  /**
   * For a result behind the head ("behind"): whether the app verifies it again at each new block
   * (false: a page with a signature from its URL, verified only when it loads).
   */
  followed?: boolean;
}) {
  const now = useNowSeconds();
  const { away, failing } = useLive();
  const labels = freshnessLabels(set, refresh, now);
  if (!set.stale) {
    const copies = check ? safeCheckLabel(check, now, away || failing) : labels.copies;
    const line = [labels.verified, copies].filter(Boolean).join(" · ");
    return line ? (
      <p className="text-slate-600 text-xs" data-testid="set-freshness">
        {line}
      </p>
    ) : null;
  }
  // The block first when there is one (a verdict), else the copies' age (a list from Safe).
  const headline = labels.verified ?? labels.copies ?? "An earlier result";
  const asOf = labels.verified ? "that block and those Safe copies" : "those Safe copies";
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
      data-testid="set-stale"
    >
      {refresh === "failed" ? (
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Loader2
          aria-hidden
          className={`mt-0.5 h-4 w-4 shrink-0${refresh === "pending" ? " motion-safe:animate-spin" : ""}`}
        />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold">{headline}</span>
        {labels.verified && labels.copies && <span className="block">{labels.copies}</span>}
        <span className="block text-xs">
          {what} are as of {asOf}, not the current state.
          {refresh === "pending" && " The current check replaces them when it arrives."}
          {refresh === "behind" &&
            (followed
              ? " They are checked again at each new block and update here once that succeeds."
              : " Check again to verify them at the current block.")}
        </span>
        {labels.failed && <span className="block font-medium">{labels.failed}</span>}
      </span>
    </div>
  );
}

/**
 * FreshnessNote for a list fed by Safe (pending emergency upgrades, freeze requests, vetoes): once
 * current, how the Safes it collects from are kept, as the beats report it ("Safe checked 2m ago ·
 * next check in 3m"). A check that finds nothing new leaves the list as it is (no reload), so the
 * copies' age the page loaded with would only grow.
 */
export function ListFreshnessNote({
  watchKey,
  ...props
}: { watchKey: string; set: Labelled; refresh?: Refresh; what?: string }) {
  const check = useLive().checked[watchKey] ?? null;
  return <FreshnessNote {...props} check={check} />;
}
