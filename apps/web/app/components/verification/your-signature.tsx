// Your signature: what the viewer can do on a page, under its title, apart from the signer groups
// (which only show where each group stands). For a connected member Safe, a row per action it can
// sign, with Review and sign and where its signature stands after; once a group reaches its
// threshold, a row to send its approval, for anyone. A visitor or a Safe that is not a member gets
// a line saying so. Scrolled past, the first thing to do stays in a bar at the bottom of the
// screen. The same rules as everywhere: a set not verified at the head served is shown as of its
// block, in no passing colour, and nothing is signed or sent from it (the buttons say why).
import type { ExecutionView, SetState } from "@/.server/flows/common";
import type { MemberResult, SignatureSet } from "@/.server/signatures";
import { useConnectWallet } from "@/components/connect-button";
import { AddressLink, ExternalAnchor } from "@/components/hex";
import { useLive, useSafeCheck } from "@/components/presence";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";
import type { SerializeFrom } from "@remix-run/node";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  Loader2,
  PenLine,
  Send,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Address, type Hex, isAddressEqual } from "viem";
import { usePageNotCurrent } from "./content-currency";
import { ExecutionPanel, SentTransaction } from "./execution-panel";
import { setStanding } from "./freshness";
import { SignButton, useSignReason } from "./sign-button";
import { SafeHashes } from "./safe-hashes";
import { useAccount } from "wagmi";
import { SafeOwnerApprovals } from "./safe-owner-approvals";

type Serialized<T> = SerializeFrom<T>;
type Member = Serialized<MemberResult>;
type Live = ReturnType<typeof useLive>;

export type SignAction = {
  key: string;
  /** What is signed, as the signer groups name it ("Security Council approval"). */
  title: string;
  set: Serialized<SignatureSet>;
  state: Serialized<SetState>;
  /** The transaction the group's signatures make, once at its threshold (anyone sends it). */
  execution?: Serialized<ExecutionView> | null;
  executionToLabel?: string;
};

const GROUP_NAME: Record<string, string> = {
  securityCouncil: "the Security Council",
  guardians: "the Guardians",
  zkFoundation: "the ZKsync Foundation",
};

export function YourSignature({
  actions,
  hint,
}: {
  actions: SignAction[];
  hint: string;
}) {
  return (
    <>
      <SafeOwnerApprovals actions={actions} />
      <SignatureActions actions={actions} hint={hint} />
    </>
  );
}

function SignatureActions({
  actions,
  hint,
}: {
  actions: SignAction[];
  /** What to check on the page before signing. */
  hint: string;
}) {
  const live = useLive();
  const { address: you } = useAccount();
  const [dialog, setDialog] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const past = useScrolledPast(panel);
  const open = actions.filter((a) => a.state.status === "open");
  if (open.length === 0) return null;

  const memberOf = (a: SignAction) =>
    you ? a.set.members.find((m) => isAddressEqual(m.member as Address, you)) : undefined;
  const signing = open.flatMap((a) => {
    const member = memberOf(a);
    return member ? [{ action: a, member }] : [];
  });
  // A first answer from an older block never makes a transaction to send.
  const sending = open.filter((a) => a.execution && a.set.stale !== true);
  const dialogOf = (kind: "sign" | "send", key: string) => ({
    open: dialog === `${kind}:${key}`,
    onOpenChange: (next: boolean) => setDialog(next ? `${kind}:${key}` : null),
  });
  // What the bar at the bottom offers: the first signature still to give, else the first to send.
  const toSign = signing.find((s) => s.member.status !== "valid");
  const toSend = sending[0];

  if (signing.length === 0 && sending.length === 0)
    return (
      <section
        ref={setPanel}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-700 sm:px-5"
        data-testid="your-signature"
        data-kind="note"
      >
        <Who you={you} open={open} member={actions.map(memberOf).find(Boolean)} />
      </section>
    );

  return (
    <>
      <section
        ref={setPanel}
        className="rounded-xl border border-brand-200 bg-brand-25"
        data-testid="your-signature"
        aria-labelledby="your-signature-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-brand-100 border-b px-4 py-3 sm:px-5">
          <h2
            id="your-signature-title"
            className="flex items-center gap-2 font-semibold text-[16px] text-navy-800"
          >
            {signing.length > 0 ? (
              <>
                <PenLine aria-hidden className="h-4 w-4" /> Your signature
              </>
            ) : (
              <>
                <Send aria-hidden className="h-4 w-4" /> Ready to send
              </>
            )}
          </h2>
        </div>
        <div className="divide-y divide-brand-100">
          {signing.map(({ action, member }) => (
            <SignRow
              key={`sign:${action.key}`}
              action={action}
              member={member}
              live={live}
              dialog={dialogOf("sign", action.key)}
            />
          ))}
          {sending.map((action) => (
            <SendRow
              key={`send:${action.key}`}
              action={action}
              live={live}
              dialog={dialogOf("send", action.key)}
            />
          ))}
          {signing.length === 0 && (
            <div className="px-4 py-3 text-[13.5px] text-slate-700 sm:px-5">
              <Who you={you} open={open} member={actions.map(memberOf).find(Boolean)} />
            </div>
          )}
        </div>
        {signing.length > 0 && (
          <p className="border-brand-100 border-t px-4 py-2.5 text-[13px] text-slate-600 sm:px-5">
            {hint}
          </p>
        )}
      </section>
      {past && (toSign || toSend) && (
        <ActionBar>
          {toSign ? (
            <BarSign
              action={toSign.action}
              member={toSign.member}
              live={live}
              onOpen={() => setDialog(`sign:${toSign.action.key}`)}
            />
          ) : toSend ? (
            <BarSend action={toSend} onOpen={() => setDialog(`send:${toSend.key}`)} />
          ) : null}
        </ActionBar>
      )}
    </>
  );
}

/** For a page with nothing for the viewer to sign: why, and for a visitor how to connect. */
function Who({
  you,
  open,
  member,
}: {
  you: Address | undefined;
  open: SignAction[];
  /** The viewer's Safe in a group here whose signing is not open now. */
  member?: Member;
}) {
  const { connectWalletConnect: openConnectModal } = useConnectWallet();
  const groups = [...new Set(open.map((a) => GROUP_NAME[a.set.signerGroup] ?? a.title))];
  if (!you)
    return (
      <>
        <span className="min-w-0" data-testid="your-signature-note">
          <span className="font-medium text-navy-800">Open for signatures: </span>
          {open.map((a) => `${a.title} ${a.set.valid.length} of ${a.set.threshold}`).join(" · ")}.
          Members connect their Safe to sign.
        </span>
        {openConnectModal && (
          <Button size="sm" variant="ghost" onClick={openConnectModal}>
            Connect wallet
          </Button>
        )}
      </>
    );
  return (
    <span className="min-w-0" data-testid="your-signature-note">
      Connected as <AddressLink address={you} label={member?.label} />
      {member
        ? " · nothing for your Safe to sign here now."
        : ` · not a member of ${groups.join(" or ")}, so nothing to sign here.`}
    </span>
  );
}

// Once the Safe has the request: what Fetch signatures does, at once and then at these seconds,
// until the member's status here changes (the row leaves "sent") or the last one has run.
const FETCH_AFTER_SIGNING_S = [0, 5, 10, 20, 30, 45, 60, 90, 120] as const;

/** Runs `fetch` on that schedule while `active`; true once the last one ran without a change. */
function useFetchAfterSigning(active: boolean, fetch: () => Promise<void>) {
  const latest = useRef(fetch);
  latest.current = fetch;
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    setGaveUp(false);
    if (!active) return;
    const timers = FETCH_AFTER_SIGNING_S.map((s, i) =>
      setTimeout(() => {
        void latest.current();
        if (i === FETCH_AFTER_SIGNING_S.length - 1) setGaveUp(true);
      }, s * 1000)
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [active]);
  return gaveUp;
}

function SignRow({
  action,
  member,
  live,
  dialog,
}: {
  action: SignAction;
  member: Member;
  live: Live;
  dialog: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const { set } = action;
  const { staleAt, notCurrent } = setStanding(set, live);
  // A first answer from an older block: nothing is signed from it until the current one is in.
  const disabledReason = set.stale ? "Not verified at the newest block yet." : notCurrent;
  // After the Safe has the request: said until its status here changes.
  const now = `${member.status}:${member.confirmations ?? 0}`;
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (sent !== null && sent !== now) setSent(null);
  }, [sent, now]);
  const check = useSafeCheck(set.watch?.key);
  const gaveUp = useFetchAfterSigning(sent !== null, check.run);
  const [hashes, setHashes] = useState(false);
  const status = myStatus(member, set, staleAt);
  const Icon = status.icon;
  return (
    <div className="space-y-2.5 px-4 py-4 sm:px-5" data-testid={`sign-row-${action.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-[15px] text-navy-800">{action.title}</p>
          <p className="text-[13.5px] text-slate-700">
            as <span className="font-semibold text-navy-800">{member.label ?? "your Safe"}</span>
          </p>
          <AddressLink address={member.member} className="text-[13px]" />
          {sent !== null ? (
            <p
              className="flex items-center gap-1.5 text-[13.5px] text-slate-700"
              role="status"
              data-testid="my-status"
            >
              {gaveUp && !check.running ? (
                <>
                  <CircleDashed aria-hidden className="h-4 w-4 shrink-0" />
                  <span>
                    Sent to your Safe, but Safe's service does not list it yet
                    {check.error ? ` (could not fetch: ${check.error})` : ""}.{" "}
                    <button
                      type="button"
                      onClick={() => void check.run()}
                      className="font-medium text-brand-700 hover:underline"
                      data-testid="fetch-again"
                    >
                      Fetch again
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <Loader2 aria-hidden className="h-4 w-4 shrink-0 motion-safe:animate-spin" />
                  Sent to your Safe · fetching its signature from Safe
                </>
              )}
            </p>
          ) : (
            <p
              className={cn("flex items-start gap-1.5 text-[13.5px]", status.tone)}
              data-testid="my-status"
            >
              <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{status.text}</span>
            </p>
          )}
        </div>
        {member.status !== "valid" && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {member.status === "collecting" && member.safeWalletUrl && (
              <ExternalAnchor href={member.safeWalletUrl} className="text-[13.5px]">
                Open in Safe{"{"}Wallet{"}"}
              </ExternalAnchor>
            )}
            <SignButton
              typedData={set.typedData}
              signerGroup={set.signerGroup}
              members={set.members}
              disabledReason={disabledReason}
              open={dialog.open}
              onOpenChange={dialog.onOpenChange}
              onSigned={() => setSent(now)}
              label={member.status === "invalid" ? "Review and sign again" : "Review and sign"}
            />
          </div>
        )}
      </div>
      {member.hashes && (
        <>
          <button
            type="button"
            onClick={() => setHashes(!hashes)}
            aria-expanded={hashes}
            className="inline-flex items-center gap-1 text-[13px] text-brand-700 hover:underline"
            data-testid="show-hashes"
          >
            <ChevronRight
              aria-hidden
              className={cn("h-3.5 w-3.5 transition-transform", hashes && "rotate-90")}
            />
            {hashes ? "Hide" : "Show"} the hashes your wallet shows
          </button>
          <div
            hidden={!hashes}
            className="rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm"
            data-testid="your-hashes"
          >
            <SafeHashes digest={set.hashes.digest} hashes={member.hashes} />
          </div>
        </>
      )}
    </div>
  );
}

function SendRow({
  action,
  live,
  dialog,
}: {
  action: SignAction;
  live: Live;
  dialog: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const { set, execution } = action;
  const { notCurrent } = setStanding(set, live);
  const blocked = notCurrent;
  // The page's own item (an upgrade's state) not read at the head served: sending waits too.
  const page = usePageNotCurrent();
  const waits = blocked
    ? "Sending waits until the signatures are verified at the current block."
    : page?.waits ?? null;
  // Sent from here: said in the row (the dialog closes) until the action shows as done.
  const [sent, setSent] = useState<Hex | null>(null);
  if (!execution) return null;
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5"
      data-testid={`send-row-${action.key}`}
    >
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-[15px] text-navy-800">{action.title} · threshold met</p>
        <p className="text-[13.5px] text-slate-700">
          Anyone can send it: the contract checks the signatures, not the sender.
        </p>
        {(blocked ?? page) && (
          <p className="text-slate-600 text-xs" data-testid="send-blocked">
            {blocked ?? page?.reason} {waits}
          </p>
        )}
        {sent && <SentTransaction hash={sent} />}
      </div>
      <Button size="sm" onClick={() => dialog.onOpenChange(true)} data-testid="review-send">
        <Send /> Review and send
      </Button>
      <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send the {action.title.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Check where it goes and what it calls, then send it from your wallet.
            </DialogDescription>
          </DialogHeader>
          <ExecutionPanel
            execution={execution}
            title="The transaction"
            toLabel={action.executionToLabel}
            blockedReason={blocked}
            onSent={(hash) => {
              setSent(hash);
              dialog.onOpenChange(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Where the viewer's own signature stands, in a line; in no colour when not current. */
function myStatus(member: Member, set: Serialized<SignatureSet>, staleAt: string | null) {
  const valid = set.valid.length;
  const met = set.thresholdCheck.status === "met";
  const count = met
    ? `the threshold is met (${valid} of ${set.threshold})`
    : `${valid} of ${set.threshold} so far`;
  const asOf = staleAt === null ? "" : `As of block #${formatNumber(staleAt)}: `;
  const quiet = staleAt !== null;
  switch (member.status) {
    case "valid":
      return {
        icon: CheckCircle2,
        tone: quiet ? "text-slate-700" : "text-green-900",
        text: `${asOf}Your signature is verified · ${count}`,
      };
    case "collecting":
      return {
        icon: CircleDashed,
        tone: quiet ? "text-slate-700" : "text-amber-950",
        text: `${asOf}${member.confirmations ?? 0} of ${member.safe.threshold ?? "?"} of your Safe's owners signed · the other owners sign the same message in Safe{Wallet}`,
      };
    case "invalid":
      return {
        icon: XCircle,
        tone: quiet ? "text-slate-700" : "text-red-900",
        text: `${asOf}The contract rejected your Safe's signature${member.error ? `: ${member.error}` : ""}`,
      };
    case "unavailable":
      return {
        icon: Circle,
        tone: "text-amber-900",
        text: `${asOf}Safe's service did not answer for your Safe · ${count}`,
      };
    default:
      return {
        icon: Circle,
        tone: "text-slate-700",
        text: `${asOf}Not signed yet · ${count}`,
      };
  }
}

/** True once the panel is above the top of the screen (scrolled past, not merely below it). */
function useScrolledPast(el: HTMLElement | null) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) =>
      setPast(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0)
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return past;
}

// Lifts the live note and the toasts above it while it is shown (--action-bar).
function ActionBar({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--action-bar", "72px");
    return () => {
      root.style.removeProperty("--action-bar");
    };
  }, []);
  return (
    <div
      className="sm:-translate-x-1/2 fixed right-[76px] bottom-4 left-4 z-30 sm:right-auto sm:bottom-6 sm:left-1/2 sm:w-[min(640px,calc(100vw-12rem))]"
      data-testid="action-bar"
    >
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-white py-2 pr-2 pl-4 shadow-[0_8px_24px_-8px_rgba(10,26,102,0.35)]">
        {children}
      </div>
    </div>
  );
}

function BarSign({
  action,
  member,
  live,
  onOpen,
}: {
  action: SignAction;
  member: Member;
  live: Live;
  onOpen: () => void;
}) {
  const { set } = action;
  const { notCurrent } = setStanding(set, live);
  const { reason } = useSignReason({
    signerGroup: set.signerGroup,
    members: set.members,
    disabledReason: set.stale ? "Not verified at the newest block yet." : notCurrent,
  });
  return (
    <>
      <PenLine aria-hidden className="h-4 w-4 shrink-0 text-navy-800" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-slate-700">
        <span className="font-semibold text-navy-800">{action.title}</span>
        <span className="hidden sm:inline">
          {" "}
          · as {member.label ?? "your Safe"} ·{" "}
          {member.status === "collecting" ? "collecting" : "not signed"}
        </span>
      </span>
      <Button
        size="sm"
        onClick={onOpen}
        disabled={!!reason}
        title={reason ?? undefined}
        data-testid="bar-sign"
      >
        <PenLine /> Review and sign
      </Button>
    </>
  );
}

function BarSend({ action, onOpen }: { action: SignAction; onOpen: () => void }) {
  return (
    <>
      <Send aria-hidden className="h-4 w-4 shrink-0 text-navy-800" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-slate-700">
        <span className="font-semibold text-navy-800">{action.title}</span>
        <span className="hidden sm:inline"> · threshold met</span>
      </span>
      <Button size="sm" onClick={onOpen} data-testid="bar-send">
        <Send /> Review and send
      </Button>
    </>
  );
}
