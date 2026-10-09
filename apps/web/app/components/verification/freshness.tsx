import type { SafeCheck } from "@/.server/safe/store";
import { useLive } from "@/components/presence";
import { useNowSeconds } from "@/components/sync-state";
import { formatAge, formatNumber, formatTime } from "@/utils/format";
import { AlertTriangle, Loader2 } from "lucide-react";

// For a stale first answer: "pending" while the fresh result streams in, "failed" when it could
// not be computed (the first answer stays, saying so); "behind": not verified at the head served.
export type Refresh = "pending" | "failed" | "behind" | null;

export type Labelled = {
  verifiedAtBlock?: string | null;
  safeFetchedAt?: string | null;
  stale?: boolean;
  reverifyingAt?: string | null;
  /** false: the current answer keeps these copies, so they are never said to be refreshing. */
  rereadsSafe?: boolean;
};

// "12s ago" by this browser's clock, or the time it was read until that clock is known (the
// server render and hydration must match).
export function copiesAge(fetchedAt: string, nowSeconds: number | null): string {
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return "an unknown time";
  return nowSeconds === null ? formatTime(fetchedAt) : formatAge(nowSeconds - ms / 1000);
}

export function freshnessLabels(set: Labelled, refresh: Refresh, nowSeconds: number | null) {
  const block = set.verifiedAtBlock ?? null;
  const at =
    set.reverifyingAt && set.reverifyingAt !== block
      ? ` at #${formatNumber(set.reverifyingAt)}`
      : "";
  const pending = refresh === "pending";
  const refreshing = pending && set.rereadsSafe !== false;
  const behind = refresh === "behind" && at !== "" ? ` · not re-verified${at}` : "";
  return {
    verified:
      block === null
        ? null
        : `Verified at block #${formatNumber(block)}${pending ? ` · re-verifying${at}` : behind}`,
    copies: set.safeFetchedAt
      ? `Safe copies from ${copiesAge(set.safeFetchedAt, nowSeconds)}${refreshing ? " · refreshing" : ""}`
      : null,
    failed:
      refresh === "failed" ? "Checking again did not complete. Refresh the page to retry." : null,
  };
}

export type Followed = Pick<Labelled, "verifiedAtBlock" | "stale"> & {
  watch?: { key: string; rev: string | null } | null;
};

// `behind`: the head served now, when the set was not verified there: it is then shown as of its
// block, in no passing colour, nothing to sign or send, until a result at a newer head replaces it.
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

// The Era head what is shown was read at, never one whose read failed (then the age just grows).
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

const UNAVAILABLE: Record<string, string> = {
  quota: "Safe quota low",
  budget: "hourly budget used",
  cooldown: "Safe rate limit",
  "quota-exhausted": "Safe's monthly quota used up",
};

export function safeUnavailableReason(
  check: SafeCheck | null | undefined,
  unavailable: number
): string | null {
  if (check?.state === "paused") {
    const why = UNAVAILABLE[check.reason ?? ""] ?? "checks paused";
    // Safe itself answers nothing during a cooldown; below the quota floor or over the hourly
    // budget only the background checks wait (Fetch signatures still reads).
    return check.reason === "cooldown" || check.reason === "quota-exhausted"
      ? `Safe unavailable (${why})`
      : `Safe checks paused (${why})`;
  }
  if (check?.state === "on-request") return "Safe read only on request (no Safe key)";
  if (unavailable > 0)
    return `Safe did not answer for ${unavailable} member${unavailable === 1 ? "" : "s"}`;
  return null;
}

const PAUSED: Record<string, string> = {
  quota: "checks paused (Safe quota low)",
  budget: "checks paused (hourly budget used)",
  cooldown: "checks paused (Safe rate limit)",
  "quota-exhausted": "checks paused (Safe's monthly quota used up)",
};

// While this tab's updates are paused (away, or the app not answering), nothing is checked for it:
// said so, never a countdown.
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

// Of the beat's report and the page's own, the one whose Safes were checked more recently, so the
// label never shows a check older than the result next to it.
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

// A stale first answer gets a notice that names its block first, so no status below reads as a
// current pass; a fresh result one quiet line.
export function FreshnessNote({
  set,
  refresh = null,
  what = "Statuses below",
  check = null,
  followed = true,
  safeReason = null,
}: {
  set: Labelled;
  refresh?: Refresh;
  what?: string;
  check?: SafeCheck | null;
  /** false: a page with a signature from its URL, verified only when it loads. */
  followed?: boolean;
  safeReason?: string | null;
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
  const unavailable = refresh === "behind" && followed && safeReason ? safeReason : null;
  const headline = [labels.verified ?? labels.copies ?? "An earlier result", unavailable]
    .filter(Boolean)
    .join(" · ");
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
            (unavailable
              ? " Fetch signatures to retry; they update here once Safe answers."
              : followed
                ? " They are checked again at each new block and update here once that succeeds."
                : " Check again to verify them at the current block.")}
        </span>
        {labels.failed && <span className="block font-medium">{labels.failed}</span>}
      </span>
    </div>
  );
}

// For a list fed by Safe, once current: how its Safes are kept, from the beats (a check that finds
// nothing new does not reload the list, so the copies' age it loaded with would only grow).
export function ListFreshnessNote({
  watchKey,
  ...props
}: { watchKey: string; set: Labelled; refresh?: Refresh; what?: string }) {
  const check = useLive().checked[watchKey] ?? null;
  return <FreshnessNote {...props} check={check} />;
}
