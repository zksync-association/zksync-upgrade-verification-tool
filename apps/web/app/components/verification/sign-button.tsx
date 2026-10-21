import type { MemberResult } from "@/.server/signatures";
import {
  type GovernanceTypedData,
  type SignerGroup,
  governanceHashes,
  toSignable,
} from "@/common/typed-data";
import { GROUP_LABEL, useConnectWallet, useConnectedGroups } from "@/components/connect-button";
import { AddressLink } from "@/components/hex";
import { useHoldUpdates, usePresence } from "@/components/presence";
import { Button } from "@/components/ui/button";
import { usePageNotCurrent } from "@/components/verification/content-currency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SafeHashes } from "@/components/verification/safe-hashes";
import { requestStatusRevalidation } from "@/utils/revalidation";
import type { SerializeFrom } from "@remix-run/node";
import { useRevalidator } from "@remix-run/react";
import { PenLine } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "react-hot-toast";
import { isAddressEqual } from "viem";
import { useSignTypedData } from "wagmi";

// Signing is a request to the connected member Safe (this app opened inside Safe{Wallet}, or
// WalletConnect). The Safe files the message in its Transaction Service; this page then picks it
// up from there and checks it on-chain like every other signature. Nothing is posted to this app.
// While the dialog is open or the wallet request is pending, the page's data is not reloaded (the
// hashes being compared never change under the signer); a reload that waits says so.

/**
 * Why the connected account cannot sign now, or null: the set not current, the page's own item not
 * current, the roles not read yet, not a member, already verified.
 */
export function useSignReason({
  signerGroup,
  members,
  disabledReason,
}: {
  signerGroup: SignerGroup;
  members: SerializeFrom<MemberResult>[];
  disabledReason: string | null;
}) {
  const { address, groups, known } = useConnectedGroups();
  const member = address
    ? members.find((m) => isAddressEqual(m.member as `0x${string}`, address))
    : undefined;
  const isMember = groups.includes(signerGroup);
  // The page's own item (an upgrade's state) not read at the head served: signing waits too.
  const page = usePageNotCurrent();
  const blocked = disabledReason ?? page?.reason ?? null;
  let reason = blocked;
  if (!reason && address && !known) reason = "Reading the governance roles…";
  if (!reason && address && !isMember)
    reason = `The connected account is not a ${GROUP_LABEL[signerGroup]} member Safe.`;
  if (!reason && member?.status === "valid") reason = "Your Safe's signature is already verified.";
  return { address, member, blocked, reason };
}

export function SignButton({
  typedData,
  signerGroup,
  members,
  disabledReason,
  open: controlled,
  onOpenChange,
  onSigned,
  label,
  caution,
}: {
  typedData: GovernanceTypedData;
  signerGroup: SignerGroup;
  members: SerializeFrom<MemberResult>[];
  disabledReason: string | null;
  /** The review dialog, when opened from elsewhere too (Your signature's bar). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The Safe has the request. */
  onSigned?: () => void;
  label?: ReactNode;
  /** Said first in the review, before what is signed (e.g. a payload not checked against the id). */
  caution?: ReactNode;
}) {
  const { address, member, blocked, reason } = useSignReason({
    signerGroup,
    members,
    disabledReason,
  });
  const { connect: openConnectModal } = useConnectWallet();
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const revalidator = useRevalidator();
  const { signTypedData, isPending } = useSignTypedData();
  const presence = usePresence();
  const waiting = useHoldUpdates(open || isPending);

  if (!address) {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={openConnectModal}
          disabled={!!blocked}
          title={blocked ?? undefined}
        >
          <PenLine /> Connect your Safe to sign
        </Button>
        {/* Said, not only as a tooltip (a phone has none). */}
        {blocked && (
          <span className="text-slate-600 text-xs" data-testid="sign-blocked">
            {blocked}
          </span>
        )}
      </>
    );
  }

  const sign = () => {
    toast.loading("Waiting for your Safe…", { id: "sign" });
    signTypedData(toSignable(typedData) as Parameters<typeof signTypedData>[0], {
      onSuccess: () => {
        toast.success("Sent to your Safe. It shows here once Safe has the signature.", {
          id: "sign",
        });
        setOpen(false);
        onSigned?.();
        // The server checks the Safe's listing soon (sync/presence.ts).
        if (address) presence.signed(address);
        // Also reads the root status again (revalidation.ts).
        requestStatusRevalidation();
        revalidator.revalidate();
      },
      onError: (error) => {
        toast.error(error.message.split("\n")[0] ?? "Signing failed", { id: "sign" });
      },
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!!reason}
        title={reason ?? undefined}
        data-testid="sign-button"
      >
        <PenLine /> {label ?? `Sign as ${member?.label ?? GROUP_LABEL[signerGroup]}`}
      </Button>
      {reason && (
        <span className="text-slate-600 text-xs" data-testid="sign-blocked">
          {reason}
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review before signing in your Safe</DialogTitle>
            <DialogDescription>
              Your Safe will ask its owners to sign a SafeMessage wrapping the governance digest
              below. Compare what Safe{"{"}Wallet{"}"} and your wallet show with these before you
              confirm.
            </DialogDescription>
          </DialogHeader>
          {caution}
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[150px_1fr]">
            <dt className="text-slate-600">Action</dt>
            <dd className="mono">{typedData.primaryType}</dd>
            <dt className="text-slate-600">Contract</dt>
            <dd className="mono">
              {typedData.domain.name} v{typedData.domain.version}
            </dd>
            <dt className="text-slate-600">Address</dt>
            <dd className="min-w-0">
              <AddressLink address={typedData.domain.verifyingContract} />
            </dd>
            {Object.entries(typedData.message).map(([key, value]) => (
              <Row key={key} label={key} value={value} />
            ))}
          </dl>
          {member?.hashes ? (
            <div className="rounded-xl bg-slate-50 p-4">
              <SafeHashes digest={governanceHashes(typedData).digest} hashes={member.hashes} />
            </div>
          ) : (
            <p className="text-amber-900 text-sm">
              The connected account is not a Safe. This page only picks up signatures that a member
              Safe files with Safe's service.
            </p>
          )}
          {waiting && (
            <p className="text-slate-600 text-xs" role="status" data-testid="update-held">
              New data · applies when you close this
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sign} loading={isPending} data-testid="confirm-sign">
              Send signature request to Safe
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="mono break-all">{value}</dd>
    </>
  );
}
