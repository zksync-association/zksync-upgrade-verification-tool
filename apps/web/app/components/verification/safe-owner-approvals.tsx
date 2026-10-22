import type { SignAction } from "./your-signature";
import { SAFE_OWNER_APPROVAL, type SafeOwnerApprovalPlan } from "@/common/safe-owner-approval";
import { useConnectWallet } from "@/components/connect-button";
import { useStatusIfRead } from "@/components/governance-context";
import { AddressLink, CopyButton, Hash, TxLink } from "@/components/hex";
import { useHoldUpdates, usePresence } from "@/components/presence";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STORAGE_PREFIX } from "@/common/storage-prefix";
import { usePageNotCurrent } from "./content-currency";
import { type Address, type Hex, isAddressEqual } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { useState } from "react";

type Sent = { status: "awaiting" | "pending" | "uncertain" | "reverted"; hash?: Hex };

export function SafeOwnerApprovals({ actions }: { actions: SignAction[] }) {
  const status = useStatusIfRead();
  const action = actions.find(
    (_action) =>
      _action.set.action === "ApproveUpgradeSecurityCouncil" && _action.state.status === "open"
  );
  if (
    !action ||
    !status ||
    status.governance.network.chainId !== SAFE_OWNER_APPROVAL.chainId ||
    !isAddressEqual(status.governance.upgradeHandler as Address, SAFE_OWNER_APPROVAL.handler)
  )
    return null;
  return <SafeOwnerApprovalsBody status={status} action={action} />;
}

function SafeOwnerApprovalsBody({
  status,
  action,
}: {
  status: NonNullable<ReturnType<typeof useStatusIfRead>>;
  action: SignAction;
}) {
  const account = useAccount();
  const { data: wallet } = useWalletClient();
  const { connectMetaMask } = useConnectWallet();
  const { reload } = usePresence();
  const page = usePageNotCurrent();
  const [review, setReview] = useState<SafeOwnerApprovalPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useState(0);
  useHoldUpdates(busy || review !== null);
  const members = action.set.members.filter(
    (_member) =>
      _member.safe.version === "1.3.0" &&
      _member.safe.threshold === 1 &&
      _member.safe.owners.length === 1
  );
  if (!members.length) return null;
  const direct = account.connector?.id === "io.metamask" || account.connector?.id === "metaMask";
  const blocked =
    page?.reason ??
    (action.set.stale ? "Waiting for current governance verification." : null) ??
    (status.governance.warnings.length ||
    status.governance.network.overrides.length ||
    status.logHistory.status !== "ok" ||
    status.sync.cache.state === "mismatch"
      ? "Governance verification needs attention."
      : null);
  const owner = account.address;
  const id = action.set.typedData.message.id ?? "";
  const key = (_safe: Address) =>
    `${STORAGE_PREFIX}safe-owner-approval:${id}:${_safe}:${action.set.hashes.digest}`;
  const entry = (_safe: Address): Sent | null => {
    try {
      const value = localStorage.getItem(key(_safe));
      return value ? JSON.parse(value) : null;
    } catch {
      return { status: "uncertain" };
    }
  };
  const save = (_safe: Address, _value: Sent | null) => {
    if (_value) localStorage.setItem(key(_safe), JSON.stringify(_value));
    else localStorage.removeItem(key(_safe));
    redraw((_n) => _n + 1);
  };
  const load = async (_safe: Address, _owner: Address) => {
    const query = new URLSearchParams({ id, safe: _safe, owner: _owner });
    const sent = entry(_safe);
    if (sent?.hash) query.set("hash", sent.hash);
    const response = await fetch(`/resources/safe-owner-approval?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const value = (await response.json()) as { plan?: SafeOwnerApprovalPlan; error?: string };
    if (!response.ok || !value.plan)
      throw new Error(value.error ?? "Could not prepare Safe approval.");
    if (value.plan.digest.toLowerCase() !== action.set.hashes.digest.toLowerCase())
      throw new Error("The current governance digest changed. Refresh the page before approving.");
    return value.plan;
  };
  const prepare = async (_safe: Address) => {
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await load(_safe, owner);
      if (plan.alreadyApproved) {
        save(_safe, null);
        reload();
      } else if (plan.previousSubmission?.status === "reverted") {
        save(_safe, { status: "reverted", hash: plan.previousSubmission.hash });
        setReview(plan);
      } else if (!entry(_safe)) setReview(plan);
      else
        setError(
          "This Safe has a pending or uncertain submission. Check its transaction in your wallet; it will not be resent automatically."
        );
    } catch (_error) {
      setError(_error instanceof Error ? _error.message : String(_error));
    } finally {
      setBusy(false);
    }
  };
  const sendUnlocked = async () => {
    if (!review || !wallet || !owner || blocked || busy) return;
    setBusy(true);
    setError(null);
    let requested = false;
    try {
      const plan = await load(review.safe, owner);
      if (plan.alreadyApproved) {
        save(plan.safe, null);
        setReview(null);
        reload();
        return;
      }
      if (
        plan.data !== review.data ||
        plan.owner !== review.owner ||
        plan.gasLimit !== review.gasLimit ||
        (entry(plan.safe) && plan.previousSubmission?.status !== "reverted")
      )
        throw new Error("The reviewed call or its submission state changed. Review it again.");
      if ((await wallet.getChainId()) !== plan.chainId)
        throw new Error("Switch MetaMask to Sepolia.");
      const [currentOwner] = await wallet.getAddresses();
      if (!currentOwner || !isAddressEqual(currentOwner, plan.owner))
        throw new Error("Select the reviewed Safe owner in MetaMask.");
      const latest = entry(plan.safe);
      if (
        latest &&
        !(
          latest.status === "reverted" &&
          latest.hash === plan.previousSubmission?.hash &&
          plan.previousSubmission?.status === "reverted"
        )
      )
        throw new Error("This Safe already has a submission in another tab.");
      // Store before asking: a lost wallet response must not make it safe to resend.
      save(plan.safe, { status: "awaiting" });
      requested = true;
      const hash = await wallet.sendTransaction({
        account: plan.owner,
        chain: wallet.chain,
        to: plan.to,
        data: plan.data,
        value: 0n,
        gas: BigInt(plan.gasLimit),
      });
      save(plan.safe, { status: "pending", hash });
      setReview(null);
      reload();
    } catch (_error) {
      const rejection = _error as { code?: number; cause?: { code?: number }; name?: string };
      if (requested && review)
        save(
          review.safe,
          rejection.code === 4001 ||
            rejection.cause?.code === 4001 ||
            rejection.name === "UserRejectedRequestError"
            ? null
            : { status: "uncertain" }
        );
      setError(
        _error instanceof Error
          ? _error.message.split("\n")[0] ?? "Wallet request failed"
          : String(_error)
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!navigator.locks) {
      setError("Open the served HTML in a browser with transaction coordination support.");
      return;
    }
    await navigator.locks.request(
      `${STORAGE_PREFIX}safe-owner-approvals`,
      { ifAvailable: true },
      async (_lock) => {
        if (!_lock) {
          setError("Another tab has a wallet request open. Complete it first.");
          return;
        }
        await sendUnlocked();
      }
    );
  };
  return (
    <section
      className="space-y-4 rounded-xl border border-brand-200 bg-brand-25 p-5"
      data-testid="safe-owner-approvals"
    >
      <h2 className="font-semibold text-lg text-navy-800">Approve member Safes with MetaMask</h2>
      <p className="text-sm">
        Use the owner wallet to approve this upgrade through each 1-of-1 member Safe. No Safe
        pairing is needed. The Council needs {action.set.threshold} verified member approvals; each
        send uses Sepolia gas.
      </p>
      {!direct && (
        <Button onClick={connectMetaMask} disabled={!connectMetaMask || busy}>
          Connect MetaMask owner
        </Button>
      )}
      {blocked && <p role="status">{blocked}</p>}
      {error && (
        <p role="alert" className="break-words text-red-800">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {members.map((_member) => {
          const safe = _member.member as Address;
          const sent = entry(safe);
          const owns = owner && isAddressEqual(_member.safe.owners[0] as Address, owner);
          return (
            <div
              key={safe}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3"
            >
              <div>
                <AddressLink address={safe} />
                <p className="text-slate-600 text-xs">
                  {_member.status === "valid"
                    ? "Verified by governance"
                    : sent
                      ? sent.status === "reverted"
                        ? "Previous transaction reverted — retry available"
                        : "Submission recorded — check before sending again"
                      : "Ready for owner review"}
                </p>
                {sent?.hash && <TxLink hash={sent.hash} />}
              </div>
              <Button
                size="sm"
                disabled={busy || !direct || !owns || !!blocked || _member.status === "valid"}
                onClick={() => void prepare(safe)}
              >
                {sent?.status === "reverted"
                  ? "Retry failed approval"
                  : sent
                    ? "Check approval / retry if failed"
                    : "Review approval"}
              </Button>
            </div>
          );
        })}
      </div>
      <Dialog
        open={review !== null}
        onOpenChange={(_open) => {
          if (!_open && !busy) setReview(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approve this upgrade through the member Safe</DialogTitle>
            <DialogDescription>
              MetaMask sends one zero-value transaction to the Safe. Its on-chain approval is then
              verified before the Council counts it.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-3 text-sm">
              <p>Network: Sepolia</p>
              <p>
                Member Safe: <AddressLink address={review.safe} />
              </p>
              <p>
                Owner: <AddressLink address={review.owner} />
              </p>
              <p>
                Governance digest: <Hash value={review.digest} />
              </p>
              <p>
                Safe message hash: <Hash value={review.safeMessageHash} />
              </p>
              <p>Value: 0 ETH. Review the gas fee in MetaMask.</p>
              <p>
                Gas limit: {review.gasLimit}. This includes an allowance for MetaMask's wallet
                wrapper; unused gas is not charged.
              </p>
              {review.previousSubmission?.status === "reverted" && (
                <p role="status">
                  The previous transaction reverted on-chain. This is a new attempt, requiring your
                  confirmation.
                </p>
              )}
              <details>
                <summary>Exact transaction calldata</summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {review.data}
                </pre>
                <CopyButton value={review.data} label="Copy calldata" />
              </details>
              <Button disabled={busy || !!blocked} onClick={() => void send()}>
                {busy ? "Checking…" : "Send to MetaMask"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
