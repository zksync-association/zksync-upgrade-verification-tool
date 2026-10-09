import type { ExecutionView, SetState, UsedSignature } from "@/.server/flows/common";
import type { MemberResult, SignatureSet } from "@/.server/signatures";
import { AddressLink, CopyButton, ExternalAnchor, Hash, TxLink } from "@/components/hex";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/cn";
import { useLive, usePresence, useSafeCheck, useWatchItem } from "@/components/presence";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/utils/format";
import type { SerializeFrom } from "@remix-run/node";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { isAddressEqual } from "viem";
import { useAccount } from "wagmi";
import { MemberStatusBadge, SetStateBadge } from "./badges";
import { ExecutionPanel } from "./execution-panel";
import { FreshnessNote, type Refresh, newerCheck, setCurrency } from "./freshness";
import { SignButton } from "./sign-button";

type Serialized<T> = SerializeFrom<T>;

export function SignatureSetCard({
  title,
  set,
  state,
  execution,
  executionToLabel,
  used,
  historical,
  footer,
  testId,
  refresh = null,
}: {
  title: string;
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  execution?: Serialized<ExecutionView> | null;
  executionToLabel?: string;
  used?: Serialized<UsedSignature>[] | null;
  historical?: { block: string; accepted: boolean | null; error: string | null } | null;
  footer?: ReactNode;
  testId?: string;
  /** For a stale first answer (`set.stale`): where the fresh result is (see UntilFresh). */
  refresh?: Refresh;
}) {
  // On screen while shown, with the revision of what is shown: the engine verifies the set again
  // at each new block, and the page reloads when the content changed.
  useWatchItem(set.watch);
  const live = useLive();
  const valid = set.valid.length;
  const met = set.thresholdCheck.status === "met";
  // The newest block the content shown was verified at, and the head served now when the set was
  // not verified there (its reads failed, it needs Safe, or a ?sig= page that is never followed).
  const { block: verifiedAt, behind } = setCurrency(set, live);
  // A page's first answer from an older block or old Safe copies, or a result behind the head
  // served: every verdict is shown as of its block, nothing in a passing colour, and nothing to
  // sign or send from it (a Sign dialog already open stays, disabled buttons say why).
  const staleAt = set.stale ? set.verifiedAtBlock ?? "?" : behind !== null ? verifiedAt : null;
  const notCurrent = behind === null ? null : `Not verified at block #${formatNumber(behind)} yet.`;
  const followed = set.watch?.rev !== null && set.watch?.rev !== undefined;
  const unavailable = set.members.filter((m) => m.status === "unavailable").length;
  const incomplete =
    set.thresholdCheck.status === "below" && (unavailable > 0 || !!set.safeApiError);
  return (
    <Card
      data-testid={testId}
      data-stale={staleAt === null ? undefined : "true"}
      className="overflow-hidden"
    >
      <div className="space-y-3 border-slate-200 border-b bg-slate-50 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-[19px] text-navy-800">{title}</h3>
              <SetStateBadge state={state} />
            </div>
            {state.status !== "open" && <p className="text-slate-600 text-sm">{state.detail}</p>}
          </div>
          <div className="shrink-0 text-left sm:text-right">
            {incomplete ? (
              <>
                <p className="font-semibold text-amber-900 text-base" data-testid="signature-count">
                  {valid} verified · check incomplete
                </p>
                <p className="text-slate-700 text-xs">Contract threshold: {set.threshold}</p>
              </>
            ) : (
              <>
                <p
                  className="font-semibold text-[28px] text-navy-800 tabular-nums leading-8"
                  data-testid="signature-count"
                >
                  {valid}
                  <span className="font-normal text-slate-700 text-xl"> / {set.threshold}</span>
                </p>
                <p className="text-slate-600 text-xs">
                  {staleAt !== null
                    ? `verified at block #${formatNumber(staleAt)} / required`
                    : state.status === "open"
                      ? "verified signatures / required"
                      : "verified today / current threshold"}
                </p>
              </>
            )}
          </div>
        </div>
        {state.status === "open" && !incomplete && (
          <Progress
            value={(valid / Math.max(set.threshold, 1)) * 100}
            indicatorClassName={cn(met && staleAt === null && "bg-green-700")}
            aria-label="Verified signatures toward the contract threshold"
          />
        )}
        {state.status === "done" && (
          <DoneSummary state={state} used={used} historical={historical} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {/* On a phone the label has its own line and the buttons the next, whatever the label
              says (a shorter one after an update never pulls them up beside it). */}
          <div className="min-w-0 basis-full sm:basis-auto">
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
              check={
                staleAt === null && state.status === "open" && set.safeCheck !== null
                  ? newerCheck(set.watch ? live.checked[set.watch.key] : null, set.safeCheck)
                  : null
              }
            />
          </div>
          {state.status === "open" &&
          (staleAt === null || behind !== null) &&
          set.watch &&
          set.members.some((m) => m.safe.isContract) ? (
            <FetchSignatures watchKey={set.watch.key} />
          ) : (
            behind !== null && <CheckAgain />
          )}
        </div>
        <ThresholdLine set={set} state={state} incomplete={incomplete} staleAt={staleAt} />
        {set.safeApiError && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 text-sm">
            Safe Transaction Service: {set.safeApiError}. On-chain approvals are still checked.
          </p>
        )}
      </div>

      <details open={state.status === "open"} className="group/members">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-slate-800 text-sm hover:bg-slate-50 sm:px-6 [&::-webkit-details-marker]:hidden">
          Current member signatures · {set.members.length} members
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 transition-transform group-open/members:rotate-180"
          />
        </summary>
        <MemberList set={set} staleAt={staleAt} />
      </details>

      <div className="space-y-4 border-slate-200 border-t px-4 py-5 sm:px-6">
        {execution && (
          <ExecutionPanel
            execution={execution}
            toLabel={executionToLabel}
            blockedReason={notCurrent}
          />
        )}
        <SignedData set={set} />
        {state.status === "open" && (staleAt === null || behind !== null) && (
          <div className="flex flex-wrap items-center gap-3">
            <SignButton
              typedData={set.typedData}
              signerGroup={set.signerGroup}
              members={set.members}
              disabledReason={notCurrent}
            />
          </div>
        )}
        {footer}
      </div>
    </Card>
  );
}

/**
 * "Fetch signatures": reads the set's member Safes now and checks the signatures again at the
 * current block; the card updates in place. Safe is also asked on its own every minute or so while
 * the set is on screen (the label beside says when).
 */
function FetchSignatures({ watchKey }: { watchKey: string }) {
  const check = useSafeCheck(watchKey);
  return (
    <span className="flex flex-wrap items-center gap-2">
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
    </span>
  );
}

/**
 * For a result behind the head served (see setCurrency): reloads the page's data now, which
 * verifies the set at the current head (a page with a signature from its URL included).
 */
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
  state,
  incomplete,
  staleAt,
}: {
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  incomplete: boolean;
  staleAt: string | null;
}) {
  const check = set.thresholdCheck;
  if (staleAt !== null && check.status !== "below") {
    // An older block's verdict: stated as of that block, in no passing (or failing) colour.
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 text-sm"
        data-testid="threshold-stale"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>
          At block #{formatNumber(staleAt)}{" "}
          {check.status === "met" ? (
            <>
              the threshold was met: accepted by{" "}
              <span className="mono break-all">{check.checkedWith}</span>
            </>
          ) : (
            <>
              the contract rejected the combined signatures:{" "}
              <span className="mono">{check.error}</span>
            </>
          )}
          . Not yet confirmed at the current head.
        </span>
      </p>
    );
  }
  if (check.status === "met") {
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-2 font-semibold text-green-900 text-sm"
        data-testid="threshold-met"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Threshold met. Accepted by <span className="mono break-all">{check.checkedWith}</span>
        </span>
      </p>
    );
  }
  if (check.status === "rejected") {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 px-3 py-2 font-semibold text-red-900 text-sm">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          The contract rejected the combined signatures: <span className="mono">{check.error}</span>
        </span>
      </p>
    );
  }
  if (incomplete) {
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-sm"
        data-testid="threshold-incomplete"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Some signatures could not be checked. The verified count is a lower bound, not proof of
          missing signatures. Retry when the source is available.
        </span>
      </p>
    );
  }
  if (state.status === "done") {
    return (
      <p className="text-slate-700 text-sm" data-testid="threshold-below">
        Safe's copies no longer reach the threshold today (for example, because owners changed). The
        recorded transaction above is the evidence for this completed action.
      </p>
    );
  }
  if (state.status === "closed") {
    return (
      <p className="text-slate-700 text-sm" data-testid="threshold-below">
        Current copies are below the threshold. This action is closed; no further signatures are
        needed for it.
      </p>
    );
  }
  return (
    <p
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 text-sm"
      data-testid="threshold-below"
    >
      {check.threshold - check.valid} more valid signature
      {check.threshold - check.valid === 1 ? "" : "s"} needed
      {staleAt !== null && ` as of block #${formatNumber(staleAt)}`}.
    </p>
  );
}

function MemberList({ set, staleAt }: { set: Serialized<SignatureSet>; staleAt: string | null }) {
  // Only the connected account: the list never waits for the root status.
  const { address } = useAccount();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="border-slate-200 border-t" data-testid="member-list">
      {set.members.map((m) => {
        const isYou = !!address && isAddressEqual(m.member as `0x${string}`, address);
        const expanded = open === m.member || (open === null && isYou);
        return (
          <li
            key={m.member}
            className={cn(
              "border-slate-200 border-b last:border-b-0",
              staleAt === null && m.status === "valid" && "bg-green-50/40",
              staleAt === null && m.status === "invalid" && "bg-red-50/40"
            )}
            data-testid="member-row"
            data-status={m.status}
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? "" : m.member)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-75 sm:items-center sm:gap-4 sm:px-6"
              aria-expanded={expanded}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 font-medium text-slate-950 text-sm">
                    {m.label ?? "Member"}
                    {isYou && (
                      <span className="rounded-full bg-brand-50 px-2 text-[11px] text-brand-600">
                        you
                      </span>
                    )}
                  </span>
                  <span className="mono break-all text-slate-800">{m.member}</span>
                </span>
                <span className="hidden w-32 text-slate-600 text-xs md:block">
                  {m.safe.isContract
                    ? `Safe ${m.safe.version ?? "?"} · ${m.safe.threshold ?? "?"} of ${m.safe.owners.length}`
                    : "Not a Safe"}
                </span>
                <span className="flex sm:w-56 sm:justify-end">
                  <MemberStatusBadge
                    status={m.status}
                    source={m.source}
                    confirmations={m.confirmations}
                    safeThreshold={m.safe.threshold}
                    staleAt={staleAt}
                  />
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-slate-600 transition-transform sm:mt-0",
                  expanded && "rotate-180"
                )}
              />
            </button>
            {expanded && <MemberDetail member={m} />}
          </li>
        );
      })}
    </ul>
  );
}

function MemberDetail({ member: m }: { member: Serialized<MemberResult> }) {
  return (
    <div className="space-y-4 bg-slate-25 px-4 pt-1 pb-5 text-sm sm:px-6">
      {m.hashes && (
        <div className="space-y-2">
          <p className="font-medium text-slate-950">
            A hardware wallet signing for this Safe shows
          </p>
          <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[150px_1fr]">
            <dt className="text-slate-600">Domain hash</dt>
            <dd>
              <Hash value={m.hashes.domainHash} />
            </dd>
            <dt className="text-slate-600">Message hash</dt>
            <dd>
              <Hash value={m.hashes.messageHash} />
            </dd>
            <dt className="text-slate-600">SafeMessage hash</dt>
            <dd>
              <Hash value={m.hashes.safeMessageHash} />
            </dd>
          </dl>
          <p className="text-slate-600 text-xs">
            {m.safe.domainSeparatorMatches === true
              ? "The Safe's on-chain domainSeparator() equals the domain hash above."
              : m.safe.domainSeparatorMatches === false
                ? "Warning: the Safe's on-chain domainSeparator() differs from the domain hash above."
                : "The Safe's domainSeparator() could not be read."}{" "}
            The SafeMessage hash is also the id Safe{"{"}Wallet{"}"} shows for the message.
          </p>
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

function SignedData({ set }: { set: Serialized<SignatureSet> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-medium text-slate-950 text-sm"
        aria-expanded={open}
      >
        <span className="min-w-0 break-words">What members sign: {set.typedData.primaryType}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-600 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="space-y-3 border-slate-200 border-t px-4 py-4 text-sm">
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
            <pre className="mono max-h-72 overflow-auto rounded-lg bg-slate-50 p-3">
              {JSON.stringify(set.typedData, null, 2)}
            </pre>
            <CopyButton
              value={JSON.stringify(set.typedData, null, 2)}
              className="absolute top-2 right-2"
              label="Copy typed data"
            />
          </div>
          <p className="text-slate-600 text-xs">
            The domain is read from the contract's eip712Domain(). Each member Safe wraps the digest
            in its own SafeMessage (expand a member above for the hashes its owners sign).
          </p>
        </div>
      )}
    </div>
  );
}

function DoneSummary({
  state,
  used,
  historical,
}: {
  state: Extract<Serialized<SetState>, { status: "done" }>;
  used?: Serialized<UsedSignature>[] | null;
  historical?: { block: string; accepted: boolean | null; error: string | null } | null;
}) {
  const matching = used?.filter((u) => u.matchesSafe === true).length ?? 0;
  const unavailable = used?.filter((u) => u.matchesSafe === null).length ?? 0;
  return (
    <div
      className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm"
      data-testid="done-summary"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-green-900">
        <CheckCircle2 className="h-4 w-4 shrink-0" /> {state.detail}
        {state.txHash && (
          <>
            {" "}
            in <TxLink hash={state.txHash} />
          </>
        )}
      </p>
      {used && (
        <p className="text-slate-950">
          The transaction passed {used.length} signature{used.length === 1 ? "" : "s"};{" "}
          {unavailable > 0 ? (
            <span data-testid="used-match">
              {unavailable} Safe {unavailable === 1 ? "copy could" : "copies could"} not be
              compared.
              {matching > 0 &&
                ` ${matching} of ${used.length} are byte-for-byte identical to the copies in Safe.`}
            </span>
          ) : (
            <>
              <span data-testid="used-match">
                {matching} of {used.length}
              </span>{" "}
              are byte-for-byte identical to the copies in Safe.
            </>
          )}
          {used.some((u) => u.matchesSafe === false) && (
            <span className="text-amber-800">
              {" "}
              Some differ from Safe's current copy (for example, it no longer lists an owner's
              confirmation). The re-check below shows whether the contract accepted what was used.
            </span>
          )}
        </p>
      )}
      {historical && (
        <p
          className={cn(
            "font-medium text-sm",
            historical.accepted === true
              ? "text-green-900"
              : historical.accepted === false
                ? "text-red-900"
                : "text-slate-800"
          )}
        >
          {historical.accepted === true &&
            `Re-checked at block ${historical.block} (just before execution): accepted.`}
          {historical.accepted === false &&
            `Re-checked at block ${historical.block}: rejected (${historical.error}).`}
          {historical.accepted === null &&
            `Not re-checked at block ${historical.block}: ${historical.error}.`}
        </p>
      )}
    </div>
  );
}
