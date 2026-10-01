import type { ExecutionView, SetState, UsedSignature } from "@/.server/flows/common";
import type { MemberResult, SignatureSet } from "@/.server/signatures";
import { useConnectedGroups } from "@/components/connect-button";
import { AddressLink, CopyButton, ExternalAnchor, Hash, TxLink } from "@/components/hex";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/cn";
import type { SerializeFrom } from "@remix-run/node";
import { CheckCircle2, ChevronDown, ShieldCheck, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { isAddressEqual } from "viem";
import { MemberStatusBadge, SetStateBadge } from "./badges";
import { ExecutionPanel } from "./execution-panel";
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
}) {
  const valid = set.valid.length;
  const met = set.thresholdCheck.status === "met";
  return (
    <Card data-testid={testId} className="overflow-hidden">
      <div className="space-y-3 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-[17px] text-slate-950">{title}</h3>
              <SetStateBadge state={state} />
            </div>
            {state.status !== "open" && <p className="text-slate-600 text-sm">{state.detail}</p>}
          </div>
          <div className="text-right">
            <p
              className="font-medium text-[28px] text-navy-800 leading-8 tracking-[-0.02em]"
              data-testid="signature-count"
            >
              {valid}
              <span className="text-slate-400"> / {set.threshold}</span>
            </p>
            <p className="text-slate-600 text-xs">valid signatures / required</p>
          </div>
        </div>
        <Progress
          value={(valid / Math.max(set.threshold, 1)) * 100}
          indicatorClassName={cn(met && "bg-green-600")}
        />
        <ThresholdLine set={set} />
        {set.safeApiError && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 text-sm">
            Safe Transaction Service: {set.safeApiError}. On-chain approvals are still checked.
          </p>
        )}
      </div>

      <MemberList set={set} />

      <div className="space-y-4 border-slate-200 border-t px-6 py-5">
        {state.status === "done" && (
          <DoneSummary state={state} used={used} historical={historical} />
        )}
        {execution && <ExecutionPanel execution={execution} toLabel={executionToLabel} />}
        <SignedData set={set} />
        {state.status === "open" && (
          <div className="flex flex-wrap items-center gap-3">
            <SignButton
              typedData={set.typedData}
              signerGroup={set.signerGroup}
              members={set.members}
              disabledReason={null}
            />
          </div>
        )}
        {footer}
      </div>
    </Card>
  );
}

function ThresholdLine({ set }: { set: Serialized<SignatureSet> }) {
  const check = set.thresholdCheck;
  if (check.status === "met") {
    return (
      <p className="flex items-start gap-2 text-green-700 text-sm" data-testid="threshold-met">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Threshold met. Accepted by <span className="mono break-all">{check.checkedWith}</span>
        </span>
      </p>
    );
  }
  if (check.status === "rejected") {
    return (
      <p className="flex items-start gap-2 text-red-700 text-sm">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          The contract rejected the combined signatures: <span className="mono">{check.error}</span>
        </span>
      </p>
    );
  }
  return (
    <p className="text-slate-600 text-sm" data-testid="threshold-below">
      {check.threshold - check.valid} more valid signature
      {check.threshold - check.valid === 1 ? "" : "s"} needed.
    </p>
  );
}

function MemberList({ set }: { set: Serialized<SignatureSet> }) {
  const { address } = useConnectedGroups();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="border-slate-200 border-t" data-testid="member-list">
      {set.members.map((m) => {
        const isYou = !!address && isAddressEqual(m.member as `0x${string}`, address);
        const expanded = open === m.member || (open === null && isYou);
        return (
          <li
            key={m.member}
            className="border-slate-100 border-b last:border-b-0"
            data-testid="member-row"
            data-status={m.status}
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? "" : m.member)}
              className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-slate-25"
              aria-expanded={expanded}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-medium text-slate-950 text-sm">
                  {m.label ?? "Member"}
                  {isYou && (
                    <span className="rounded-full bg-brand-50 px-2 text-[11px] text-brand-600">
                      you
                    </span>
                  )}
                </span>
                <span className="mono text-slate-600">{m.member}</span>
              </span>
              <span className="hidden w-32 text-slate-600 text-xs md:block">
                {m.safe.isContract
                  ? `Safe ${m.safe.version ?? "?"} · ${m.safe.threshold ?? "?"} of ${m.safe.owners.length}`
                  : "Not a Safe"}
              </span>
              <span className="flex w-56 justify-end">
                <MemberStatusBadge
                  status={m.status}
                  source={m.source}
                  confirmations={m.confirmations}
                  safeThreshold={m.safe.threshold}
                />
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-slate-400 transition-transform",
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
    <div className="space-y-4 bg-slate-25 px-6 pt-1 pb-5 text-sm">
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
        <p className="text-red-700">
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
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-slate-950 text-sm"
        aria-expanded={open}
      >
        What members sign: {set.typedData.primaryType}
        <ChevronDown
          className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")}
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
  return (
    <div className="space-y-2 rounded-xl bg-green-50 p-4 text-sm" data-testid="done-summary">
      <p className="flex items-center gap-2 font-medium text-green-800">
        <CheckCircle2 className="h-4 w-4" /> {state.detail}
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
          <span data-testid="used-match">
            {matching} of {used.length}
          </span>{" "}
          are byte-for-byte identical to the copies in Safe.
          {used.some((u) => u.matchesSafe === false) && (
            <span className="text-amber-800">
              {" "}
              Some differ from Safe's copy (the signers re-signed or signed elsewhere).
            </span>
          )}
        </p>
      )}
      {historical && (
        <p className="text-slate-950">
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
