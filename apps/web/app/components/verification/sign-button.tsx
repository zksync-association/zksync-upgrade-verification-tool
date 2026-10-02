import type { MemberResult } from "@/.server/signatures";
import { type GovernanceTypedData, type SignerGroup, toSignable } from "@/common/typed-data";
import { GROUP_LABEL, useConnectedGroups, useOfferWallet } from "@/components/connect-button";
import { Hash } from "@/components/hex";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SerializeFrom } from "@remix-run/node";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRevalidator } from "@remix-run/react";
import { PenLine } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { isAddressEqual } from "viem";
import { useSignTypedData } from "wagmi";

// Signing is a request to the connected member Safe (this app opened inside Safe{Wallet}, or
// WalletConnect). The Safe files the message in its Transaction Service; this page then picks it
// up from there and checks it on-chain like every other signature. Nothing is posted to this app.

export function SignButton({
  typedData,
  signerGroup,
  members,
  disabledReason,
}: {
  typedData: GovernanceTypedData;
  signerGroup: SignerGroup;
  members: SerializeFrom<MemberResult>[];
  disabledReason: string | null;
}) {
  useOfferWallet();
  const { address, groups } = useConnectedGroups();
  const { openConnectModal } = useConnectModal();
  const [open, setOpen] = useState(false);
  const revalidator = useRevalidator();
  const { signTypedData, isPending } = useSignTypedData();

  const member = address
    ? members.find((m) => isAddressEqual(m.member as `0x${string}`, address))
    : undefined;
  const isMember = groups.includes(signerGroup);

  let reason = disabledReason;
  if (!reason && address && !isMember)
    reason = `The connected account is not a ${GROUP_LABEL[signerGroup]} member Safe.`;
  if (!reason && member?.status === "valid") reason = "Your Safe's signature is already verified.";

  if (!address) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={openConnectModal}
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
      >
        <PenLine /> Connect your Safe to sign
      </Button>
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
        <PenLine /> Sign as {member?.label ?? GROUP_LABEL[signerGroup]}
      </Button>
      {reason && <span className="text-slate-600 text-xs">{reason}</span>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review before signing in your Safe</DialogTitle>
            <DialogDescription>
              Your Safe will ask its owners to sign a SafeMessage wrapping the governance digest
              below. Compare the hashes on your hardware wallet with these before you confirm.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[150px_1fr]">
            <dt className="text-slate-600">Action</dt>
            <dd className="mono">{typedData.primaryType}</dd>
            <dt className="text-slate-600">Contract</dt>
            <dd className="mono break-all">
              {typedData.domain.name} v{typedData.domain.version} ·{" "}
              {typedData.domain.verifyingContract}
            </dd>
            {Object.entries(typedData.message).map(([key, value]) => (
              <Row key={key} label={key} value={value} />
            ))}
          </dl>
          {member?.hashes ? (
            <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-medium text-slate-950">Your hardware wallet should show</p>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[150px_1fr]">
                <dt className="text-slate-600">Domain hash</dt>
                <dd>
                  <Hash value={member.hashes.domainHash} />
                </dd>
                <dt className="text-slate-600">Message hash</dt>
                <dd>
                  <Hash value={member.hashes.messageHash} />
                </dd>
                <dt className="text-slate-600">SafeMessage hash</dt>
                <dd>
                  <Hash value={member.hashes.safeMessageHash} />
                </dd>
              </dl>
            </div>
          ) : (
            <p className="text-amber-700 text-sm">
              The connected account is not a Safe. This page only picks up signatures that a member
              Safe files with Safe's service.
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
