import type { SetState, UsedSignature } from "@/.server/flows/common";
import type { MemberResult, SignatureSet } from "@/.server/signatures";
import { AddressLink, CopyButton, ExternalAnchor, Hash, useExplorer } from "@/components/hex";
import { Progress } from "@/components/ui/progress";
import { ToolButton, Toolbar } from "@/components/ui/tool-button";
import { cn } from "@/utils/cn";
import { useLive, usePresence, useSafeCheck, useWatchItem } from "@/components/presence";
import { Button } from "@/components/ui/button";
import { formatNumber, shortHex } from "@/utils/format";
import type { SerializeFrom } from "@remix-run/node";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleDashed,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { isAddressEqual } from "viem";
import { MemberStatusBadge, SetStateBadge } from "./badges";
import { ExecutedOn } from "./executed-on";
import { SafeHashes } from "./safe-hashes";
import {
  FreshnessNote,
  type Refresh,
  newerCheck,
  safeUnavailableReason,
  setStanding,
} from "./freshness";
import { useAccount } from "wagmi";

type Serialized<T> = SerializeFrom<T>;

// The approvals of an action as one table, like its calls: a row per signer group (the Security
// Council, the Guardians, the Foundation) with its state, count and result, unfolding into how it
// was verified, its members and what they sign. Open groups start unfolded unless the page folds
// them all (an emergency upgrade's three); Expand all and Typed data (every group's EIP-712 data)
// are in the header. A group's folded content stays rendered.

type Groups = {
  fold: { open: boolean; v: number };
  typed: boolean;
  unfoldOpen: boolean;
  /** Closed groups are folded away under "Show closed groups" (beside a group still in play). */
  hideClosed: boolean;
};
const GroupsContext = createContext<Groups | null>(null);

/** Column widths shared by the header and every group row (from md up). */
const GROUP_COLUMNS = "md:grid-cols-[minmax(0,1.4fr)_196px_minmax(0,1.1fr)_20px] md:gap-x-4";

export function ApprovalGroups({
  count,
  unfoldOpen = true,
  closed = 0,
  title,
  heading: Heading = "h3",
  note,
  children,
}: {
  count: number;
  /** Whether a group that can still be signed starts unfolded; false starts every group folded. */
  unfoldOpen?: boolean;
  /** How many of the groups are closed: folded away while another one is in play. */
  closed?: number;
  /** The heading above the table (else "Signer groups"), with the toolbar beside it. */
  title?: string;
  heading?: "h2" | "h3";
  note?: ReactNode;
  children: ReactNode;
}) {
  const [fold, setFold] = useState({ open: false, v: 0 });
  const [typed, setTyped] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const allOpen = fold.v > 0 && fold.open;
  // Only beside a group still in play (open or done): never a table of nothing.
  const foldsClosed = closed > 0 && closed < count;
  const hideClosed = foldsClosed && !showClosed && !typed;
  return (
    <GroupsContext.Provider value={{ fold, typed, unfoldOpen, hideClosed }}>
      <section className="space-y-3" data-testid="approval-groups">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="space-y-1">
            <Heading className="font-semibold text-lg text-navy-800">
              {title ?? `Signer group${count === 1 ? "" : "s"}`}{" "}
              <span className="font-normal text-[15px] text-slate-500">· {count}</span>
            </Heading>
            {note && <p className="max-w-3xl text-slate-600 text-sm">{note}</p>}
          </div>
          <Toolbar label="View">
            {!typed && (
              <ToolButton
                onClick={() => setFold((f) => ({ open: !(f.v > 0 && f.open), v: f.v + 1 }))}
              >
                {allOpen ? (
                  <>
                    <ChevronsDownUp aria-hidden className="h-3.5 w-3.5" /> Collapse all
                  </>
                ) : (
                  <>
                    <ChevronsUpDown aria-hidden className="h-3.5 w-3.5" /> Expand all
                  </>
                )}
              </ToolButton>
            )}
            <ToolButton onClick={() => setTyped(!typed)} pressed={typed}>
              Typed data
            </ToolButton>
          </Toolbar>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {!typed && (
            <div
              aria-hidden
              className={cn(
                "hidden bg-slate-50 px-4 py-2 font-medium text-[12.5px] text-slate-500 md:grid",
                GROUP_COLUMNS
              )}
            >
              <span>Signer group</span>
              <span>Signatures</span>
              <span>Result</span>
              <span />
            </div>
          )}
          <div className={typed ? "space-y-3 p-4" : "divide-y divide-slate-100"}>{children}</div>
          {foldsClosed && !typed && (
            <button
              type="button"
              onClick={() => setShowClosed(!showClosed)}
              aria-expanded={showClosed}
              className="flex w-full items-center gap-1.5 border-slate-100 border-t px-4 py-2.5 font-medium text-[13px] text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              data-testid="toggle-closed"
            >
              <ChevronDown
                aria-hidden
                className={cn("h-4 w-4 transition-transform", showClosed && "rotate-180")}
              />
              {showClosed
                ? "Hide closed groups"
                : `Show ${closed} closed group${closed === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </section>
    </GroupsContext.Provider>
  );
}

export function SignatureSetCard(props: SetCardProps) {
  // A card shown on its own is a table of one group.
  if (!useContext(GroupsContext))
    return (
      <ApprovalGroups count={1}>
        <SignatureSetCard {...props} />
      </ApprovalGroups>
    );
  return <GroupRow {...props} />;
}

type SetCardProps = {
  title: string;
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  used?: Serialized<UsedSignature>[] | null;
  historical?: { block: string; accepted: boolean | null; error: string | null } | null;
  footer?: ReactNode;
  testId?: string;
  refresh?: Refresh;
};

function GroupRow({
  title,
  set,
  state,
  used,
  historical,
  footer,
  testId,
  refresh = null,
}: SetCardProps) {
  // The engine verifies a watched set again at each new block; the page reloads when it changed.
  useWatchItem(set.watch);
  const live = useLive();
  const groups = useContext(GroupsContext) ?? {
    fold: { open: false, v: 0 },
    typed: false,
    unfoldOpen: true,
    hideClosed: false,
  };
  const closed = state.status === "closed";
  const { fold } = groups;
  // Open to sign: unfolded at first (unless the page folds them); done or closed: folded. Expand /
  // Collapse all decides after.
  const [open, setOpen] = useState(() =>
    fold.v > 0 ? fold.open : groups.unfoldOpen && state.status === "open"
  );
  useEffect(() => {
    if (fold.v > 0) setOpen(fold.open);
  }, [fold]);
  const valid = set.valid.length;
  const met = set.thresholdCheck.status === "met";
  // A page's first answer from an older block or old Safe copies, or a result behind the head
  // served: every verdict is shown as of its block, nothing in a passing colour (signing and
  // sending, in Your signature, wait for it too).
  const { verifiedAt, behind, staleAt } = setStanding(set, live);
  const followed = set.watch?.rev !== null && set.watch?.rev !== undefined;
  const unavailable = set.members.filter((m) => m.status === "unavailable").length;
  const incomplete =
    set.thresholdCheck.status === "below" && (unavailable > 0 || !!set.safeApiError);
  const safeCheck =
    state.status === "open" && set.safeCheck !== null
      ? newerCheck(set.watch ? live.checked[set.watch.key] : null, set.safeCheck)
      : null;
  // Fetch signatures is offered (an open set of Safes, followed, that can still be signed).
  const fetchable =
    state.status === "open" &&
    (staleAt === null || behind !== null) &&
    !!set.watch &&
    set.members.some((m) => m.safe.isContract);
  // Under the count: as of which block, and for a group that can no longer be signed, that the
  // count is today's Safe copies (its result is what was recorded).
  const countNote =
    staleAt !== null
      ? state.status === "open"
        ? `verified at block #${formatNumber(staleAt)} / required`
        : state.status === "done"
          ? `Safe copies at #${formatNumber(staleAt)}`
          : `verified at #${formatNumber(staleAt)}`
      : state.status === "done"
        ? "Safe copies today"
        : closed
          ? "verified today"
          : null;

  const [typedOpen, setTypedOpen] = useState(false);
  const freshness = (
    <FreshnessNote
      set={
        behind === null
          ? { ...set, verifiedAtBlock: verifiedAt }
          : { ...set, verifiedAtBlock: verifiedAt, stale: true, reverifyingAt: behind }
      }
      // Only a stale set is being checked again; a fresh one beside it is not.
      refresh={behind !== null ? "behind" : staleAt === null ? null : refresh}
      followed={followed}
      what="The statuses and counts on this card"
      check={staleAt === null ? safeCheck : null}
      // Behind because Safe cannot be read now: said only where Fetch signatures can retry.
      safeReason={
        behind !== null && fetchable ? safeUnavailableReason(safeCheck, unavailable) : null
      }
    />
  );
  const checkButton =
    fetchable && set.watch ? (
      <FetchSignatures watchKey={set.watch.key} />
    ) : behind !== null ? (
      <CheckAgain />
    ) : null;

  if (groups.typed)
    return (
      <div
        className="rounded-lg border border-slate-200 bg-slate-50"
        data-testid={testId}
        data-stale={staleAt === null ? undefined : "true"}
      >
        <p className="flex flex-wrap items-baseline gap-x-2 border-slate-200 border-b px-4 py-2 font-semibold text-[14px] text-navy-800">
          {title}
          <span className="mono font-normal text-[13px] text-slate-600">
            {set.typedData.primaryType}
          </span>
        </p>
        <div className="px-4 py-3">
          <SignedDataBody set={set} />
        </div>
      </div>
    );

  return (
    <div
      data-testid={testId}
      data-stale={staleAt === null ? undefined : "true"}
      data-closed={closed || undefined}
      hidden={closed && groups.hideClosed}
    >
      <div
        className={cn(
          "group/grow grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors hover:bg-slate-50",
          GROUP_COLUMNS,
          open && "bg-slate-50/70"
        )}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${title}: ${valid} of ${set.threshold}`}
      >
        {/* The group and where it stands first; its name reads as the row's link to its detail. */}
        <span className="col-start-1 row-start-1 min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className={cn(
                "font-semibold text-[15px] decoration-slate-300 underline-offset-4 group-hover/grow:underline",
                closed ? "text-slate-600" : "text-navy-800"
              )}
            >
              {title}
            </span>
            <SetStateBadge state={state} />
          </span>
          {state.status !== "open" && (
            <span className="block text-[13px] text-slate-500">{state.detail}</span>
          )}
        </span>
        <span className="col-start-1 row-start-2 min-w-0 md:col-start-2 md:row-start-1">
          {incomplete ? (
            <>
              <span
                className="block font-semibold text-[14px] text-amber-900"
                data-testid="signature-count"
              >
                {valid} verified · check incomplete
              </span>
              <span className="block text-slate-600 text-xs">
                Contract threshold: {set.threshold}
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "block tabular-nums leading-6",
                  state.status === "open"
                    ? "font-semibold text-[15px] text-navy-800"
                    : closed
                      ? "text-[14px] text-slate-500"
                      : "text-[14px] text-slate-700"
                )}
                data-testid="signature-count"
              >
                {valid} signature{valid === 1 ? "" : "s"}
                <span className="font-normal text-slate-500"> · {set.threshold} required</span>
              </span>
              {state.status === "open" && (
                <Progress
                  className="mt-0.5 h-1.5 max-w-[140px]"
                  value={(valid / Math.max(set.threshold, 1)) * 100}
                  indicatorClassName={cn(met && staleAt === null && "bg-green-700")}
                  aria-label="Verified signatures toward the contract threshold"
                />
              )}
              {countNote && <span className="block text-[12px] text-slate-500">{countNote}</span>}
            </>
          )}
        </span>
        {/* A link in it opens the transaction, not the row. */}
        <span
          className="col-start-1 row-start-3 min-w-0 md:col-start-3 md:row-start-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <GroupResult
            set={set}
            state={state}
            staleAt={staleAt}
            incomplete={incomplete}
            used={used}
            historical={historical}
          />
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "col-start-2 row-start-1 h-4 w-4 text-slate-500 transition-transform md:col-start-4",
            open && "rotate-180"
          )}
        />
      </div>

      <div hidden={!open} className="border-slate-100 border-t">
        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* How current it is, with Fetch signatures beside it: one place, however the answer
              changes (the button is never remounted). On a phone the button comes first. */}
          <div className="flex flex-col-reverse gap-x-3 gap-y-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 sm:flex-1">{freshness}</div>
            {checkButton}
          </div>
          {set.safeApiError && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 text-sm">
              Safe Transaction Service: {set.safeApiError}. On-chain approvals are still checked.
            </p>
          )}
          <MemberChips set={set} state={state} staleAt={staleAt} incomplete={incomplete} />
          {footer}
          <div className="border-slate-200 border-t pt-3">
            <SignedDataToggle
              set={set}
              open={typedOpen}
              onToggle={() => setTypedOpen(!typedOpen)}
            />
          </div>
          {typedOpen && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <SignedDataBody set={set} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Result cell: how the group stands, in a word or two (its unfolded part says it in full). */
function GroupResult({
  set,
  state,
  staleAt,
  incomplete,
  used,
  historical,
}: {
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  staleAt: string | null;
  incomplete: boolean;
  used?: Serialized<UsedSignature>[] | null;
  historical?: { block: string; accepted: boolean | null; error: string | null } | null;
}) {
  const explorer = useExplorer();
  const check = set.thresholdCheck;
  const tone = "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[14px]";
  if (state.status === "done") {
    // Done on-chain: the transaction is the evidence, whatever Safe's copies count today. Under it
    // only what would be a problem: a re-check the contract rejected, or signatures that differ
    // from Safe's copies (the JSON carries every comparison and re-check).
    const differ = used?.some((u) => u.matchesSafe === false) ?? false;
    return (
      <span className="block space-y-0.5" data-testid="done-summary">
        <span
          className={cn(tone, staleAt === null ? "text-green-900" : "text-slate-700")}
          title={state.txHash ?? undefined}
        >
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" />
          {state.txHash ? (
            <>
              In{" "}
              <ExternalAnchor href={explorer.tx(state.txHash)} className="mono text-[13px]">
                {shortHex(state.txHash, 10, 8)}
              </ExternalAnchor>
              <CopyButton value={state.txHash} label="Copy transaction hash" />
            </>
          ) : (
            "Recorded on-chain"
          )}
        </span>
        {state.txHash && <ExecutedOn at={state.at} />}
        {historical?.accepted === false && (
          <span className="block text-[12.5px] text-red-900">
            Re-check at #{formatNumber(historical.block)} rejected ({historical.error})
          </span>
        )}
        {differ && (
          <span className="block text-[12.5px] text-amber-800" data-testid="used-differ">
            Some signatures it carried differ from Safe's current copies
          </span>
        )}
      </span>
    );
  }
  if (incomplete)
    return (
      <span className={cn(tone, "text-amber-900")}>
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" /> Check incomplete
      </span>
    );
  if (staleAt !== null && check.status !== "below")
    return (
      <span className={cn(tone, "text-slate-700")}>
        <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-slate-500" />
        {check.status === "met" ? "Met" : "Rejected"} at #{formatNumber(staleAt)}
      </span>
    );
  if (state.status === "closed")
    return <span className={cn(tone, "text-slate-600")}>No signatures needed</span>;
  if (check.status === "met")
    return (
      <span
        className={cn(tone, "font-semibold text-green-900")}
        data-testid="threshold-met"
        title={`The contract accepted the combined signatures: ${check.checkedWith}`}
      >
        <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" /> Threshold met
        <span className="sr-only">. Accepted by {check.checkedWith}</span>
      </span>
    );
  if (check.status === "rejected")
    return (
      <span className={cn(tone, "font-semibold text-red-900")}>
        <XCircle aria-hidden className="h-4 w-4 shrink-0" /> Rejected by the contract
      </span>
    );
  const more = check.threshold - check.valid;
  return (
    <span className={cn(tone, "text-slate-800")}>
      {more} more needed{staleAt !== null && ` as of #${formatNumber(staleAt)}`}
    </span>
  );
}

function FetchSignatures({ watchKey }: { watchKey: string }) {
  const check = useSafeCheck(watchKey);
  return (
    // The button first, what the last press found below it: the button never moves for it.
    <span className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void check.run()}
        loading={check.running}
        disabled={check.running}
        title="Read the members' Safe signatures now and check them again on-chain"
        data-testid="fetch-signatures"
      >
        {!check.running && <RefreshCw />}
        {check.running ? "Fetching signatures…" : "Fetch signatures"}
      </Button>
      {check.error && (
        <span className="text-amber-900 text-xs" role="status">
          Could not fetch: {check.error}
        </span>
      )}
      {!check.error && check.failed > 0 && (
        <span className="text-amber-900 text-xs" role="status">
          Safe did not answer for {check.failed} member{check.failed === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}

// Reloads the page's data, which verifies the set at the current head (?sig= pages included).
function CheckAgain() {
  const { reload } = usePresence();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={reload}
      title="Check the signatures again at the current block"
      data-testid="check-again"
    >
      <RefreshCw /> Check again
    </Button>
  );
}

function ThresholdLine({
  set,
  incomplete,
  staleAt,
}: {
  set: Serialized<SignatureSet>;
  incomplete: boolean;
  staleAt: string | null;
}) {
  const check = set.thresholdCheck;
  const line = "flex items-start gap-2 text-[13.5px]";
  if (staleAt !== null && check.status !== "below") {
    // An older block's verdict: stated as of that block, in no passing (or failing) colour.
    return (
      <p
        className={cn(line, "text-slate-800")}
        data-testid="threshold-stale"
        title={check.status === "met" ? `Accepted by ${check.checkedWith}` : undefined}
      >
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>
          At block #{formatNumber(staleAt)}{" "}
          {check.status === "met" ? (
            "the threshold was met"
          ) : (
            <>
              the contract rejected the combined signatures (
              <span className="mono">{check.error}</span>)
            </>
          )}{" "}
          · not yet confirmed at the newest block.
        </span>
      </p>
    );
  }
  // Met: the row says so, and names the call in its tooltip.
  if (check.status === "met") return null;
  if (check.status === "rejected")
    return (
      <p className={cn(line, "font-semibold text-red-900")}>
        <XCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          The contract rejected the combined signatures: <span className="mono">{check.error}</span>
        </span>
      </p>
    );
  if (incomplete)
    return (
      <p className={cn(line, "text-amber-950")} data-testid="threshold-incomplete">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <span>
          Some signatures could not be checked. The verified count is a lower bound, not proof of
          missing signatures. Retry when the source is available.
        </span>
      </p>
    );
  return (
    <p className={cn(line, "text-slate-700")} data-testid="threshold-below">
      {check.threshold - check.valid} more valid signature
      {check.threshold - check.valid === 1 ? "" : "s"} needed
      {staleAt !== null && ` as of block #${formatNumber(staleAt)}`}.
    </p>
  );
}

const SOURCE_TEXT = { safe: "In Safe", onchain: "On-chain", supplied: "From URL" } as const;

/** A member's signature in words: the chip's tooltip and what a screen reader says. */
function memberStatusText(m: Serialized<MemberResult>, staleAt: string | null) {
  if (staleAt !== null && m.status === "valid") return `Valid at #${formatNumber(staleAt)}`;
  if (staleAt !== null && m.status === "invalid") return `Rejected at #${formatNumber(staleAt)}`;
  switch (m.status) {
    case "valid":
      return m.source ? `Verified · ${SOURCE_TEXT[m.source]}` : "Verified";
    case "collecting":
      return `Collecting · ${m.confirmations ?? 0} of ${m.safe.threshold ?? "?"} owners`;
    case "invalid":
      return "Rejected";
    case "unavailable":
      return "Safe API unavailable";
    default:
      return "Not signed";
  }
}

function chipLook(status: MemberResult["status"], staleAt: string | null) {
  // An older block's verdict is never in a passing (or failing) colour.
  if (staleAt !== null && (status === "valid" || status === "invalid"))
    return {
      tone: "border-slate-300 bg-slate-50 text-slate-800",
      icon: status === "valid" ? CheckCircle2 : XCircle,
    };
  switch (status) {
    case "valid":
      return { tone: "border-green-300 bg-green-50 text-green-900", icon: CheckCircle2 };
    case "invalid":
      return { tone: "border-red-300 bg-red-50 text-red-900", icon: XCircle };
    case "collecting":
      return { tone: "border-amber-300 bg-amber-50 text-amber-950", icon: CircleDashed };
    case "unavailable":
      return { tone: "border-amber-300 bg-amber-50 text-amber-950", icon: AlertTriangle };
    default:
      return { tone: "border-slate-300 bg-white text-slate-700", icon: Circle };
  }
}

function MemberChips({
  set,
  state,
  staleAt,
  incomplete,
}: {
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  staleAt: string | null;
  incomplete: boolean;
}) {
  // Only the connected account: the chips never wait for the root status.
  const { address } = useAccount();
  const [open, setOpen] = useState<string | null>(null);
  const selected = set.members.find((m) => m.member === open);
  const signed = set.members.filter((m) => m.status === "valid").length;
  return (
    <div className="space-y-3" data-testid="member-list">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13.5px] text-slate-600">
          {signed} of {set.members.length} member{set.members.length === 1 ? "" : "s"} signed
        </span>
        {set.members.map((m) => {
          const isYou = !!address && isAddressEqual(m.member as `0x${string}`, address);
          const { tone, icon: Icon } = chipLook(m.status, staleAt);
          const status = memberStatusText(m, staleAt);
          return (
            <span
              key={m.member}
              className="inline-flex"
              data-testid="member-row"
              data-status={m.status}
            >
              <button
                type="button"
                onClick={() => setOpen(open === m.member ? null : m.member)}
                aria-expanded={open === m.member}
                title={m.member}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-[13px] transition-[box-shadow,filter] hover:brightness-[0.97]",
                  tone,
                  open === m.member && "ring-2 ring-brand-200 ring-offset-1"
                )}
              >
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {m.label ?? shortHex(m.member)}
                {m.status === "collecting" && (
                  <span aria-hidden className="tabular-nums">
                    {m.confirmations ?? 0}/{m.safe.threshold ?? "?"}
                  </span>
                )}
                {isYou && (
                  <span className="rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-600">
                    you
                  </span>
                )}
                <span className="sr-only">{status}</span>
              </button>
            </span>
          );
        })}
      </div>
      {state.status === "open" && (
        <ThresholdLine set={set} incomplete={incomplete} staleAt={staleAt} />
      )}
      {selected && <MemberDetail member={selected} digest={set.hashes.digest} staleAt={staleAt} />}
    </div>
  );
}

function MemberDetail({
  member: m,
  digest,
  staleAt,
}: { member: Serialized<MemberResult>; digest: string; staleAt: string | null }) {
  return (
    <div
      className="space-y-4 rounded-lg border border-slate-200 bg-slate-25 px-4 py-3 text-sm"
      data-testid="member-detail"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-navy-800">{m.label ?? "Member"}</span>
        <AddressLink address={m.member} />
        <MemberStatusBadge
          status={m.status}
          source={m.source}
          confirmations={m.confirmations}
          safeThreshold={m.safe.threshold}
          staleAt={staleAt}
        />
        <span className="text-slate-600 text-xs">
          {m.safe.isContract
            ? `Safe ${m.safe.version ?? "?"} · ${m.safe.threshold ?? "?"} of ${m.safe.owners.length} owners`
            : "Not a Safe"}
        </span>
      </div>
      {m.hashes && (
        <div className="space-y-2">
          <SafeHashes digest={digest} hashes={m.hashes} />
          {/* Said only when it is a problem: the hashes above would not be this Safe's. */}
          {m.safe.domainSeparatorMatches === false && (
            <p className="text-red-900 text-xs" data-testid="domain-separator-differs">
              Warning: the Safe's on-chain domainSeparator() differs from the domain hash above.
            </p>
          )}
        </div>
      )}
      {m.owners.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-slate-950">Owners whose signatures are in it</p>
          <ul className="space-y-0.5">
            {m.owners.map((o) => (
              <li key={`${o.owner}-${o.kind}`} className="flex items-center gap-2">
                <AddressLink address={o.owner} />
                <span className="text-slate-600 text-xs">
                  {o.kind === "eoa" ? "EIP-712" : o.kind}
                  {m.safe.owners.some((x) =>
                    isAddressEqual(x as `0x${string}`, o.owner as `0x${string}`)
                  )
                    ? " · current owner"
                    : " · not a current owner"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.error && (
        <p className="text-red-800">
          Contract response: <span className="mono">{m.error}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4 text-slate-600 text-xs">
        {m.signedAt && <span>In Safe since {new Date(m.signedAt).toUTCString()}</span>}
        {m.signature && m.signature !== "0x" && (
          <span className="inline-flex items-center gap-1">
            Signature ({(m.signature.length - 2) / 2} bytes){" "}
            <CopyButton value={m.signature} label="Copy signature" />
          </span>
        )}
        {m.safeWalletUrl && (
          <ExternalAnchor href={m.safeWalletUrl}>
            Open in Safe{"{"}Wallet{"}"}
          </ExternalAnchor>
        )}
      </div>
    </div>
  );
}

function SignedDataToggle({
  set,
  open,
  onToggle,
}: { set: Serialized<SignatureSet>; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-md py-1 text-left font-medium text-slate-950 text-sm hover:text-brand-700"
      aria-expanded={open}
    >
      <ChevronRight
        aria-hidden
        className={cn("h-4 w-4 shrink-0 text-slate-600 transition-transform", open && "rotate-90")}
      />
      <span className="min-w-0 break-words">
        What members sign: <span className="mono">{set.typedData.primaryType}</span>
      </span>
    </button>
  );
}

function SignedDataBody({ set }: { set: Serialized<SignatureSet> }) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[150px_1fr]">
        <dt className="text-slate-600">EIP-712 digest</dt>
        <dd>
          <Hash value={set.hashes.digest} />
        </dd>
        <dt className="text-slate-600">Domain separator</dt>
        <dd>
          <Hash value={set.hashes.domainSeparator} />
        </dd>
        <dt className="text-slate-600">Struct hash</dt>
        <dd>
          <Hash value={set.hashes.structHash} />
        </dd>
      </dl>
      <div className="relative">
        <pre className="mono max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
          {JSON.stringify(set.typedData, null, 2)}
        </pre>
        <CopyButton
          value={JSON.stringify(set.typedData, null, 2)}
          className="absolute top-2 right-2"
          label="Copy typed data"
        />
      </div>
    </div>
  );
}
