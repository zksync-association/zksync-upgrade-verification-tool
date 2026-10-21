import type { SafeMessageHashes } from "@/common/safe";
import { Hash } from "@/components/hex";
import type { Hex } from "viem";

/**
 * What signing for a member Safe involves, to compare with whatever a wallet shows (Safe{Wallet}
 * and wallets differ in which of them they display): the SafeMessage (the governance digest it
 * wraps), its EIP-712 domain and message hashes, and the SafeMessage hash the owner key signs.
 */
export function SafeHashes({
  digest,
  hashes,
}: {
  digest: Hex | string;
  hashes: SafeMessageHashes | { domainHash: string; messageHash: string; safeMessageHash: string };
}) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[150px_1fr]" data-testid="safe-hashes">
      <dt className="text-slate-600">SafeMessage</dt>
      <dd>
        <Hash value={digest} />
      </dd>
      <dt className="text-slate-600">Domain hash</dt>
      <dd>
        <Hash value={hashes.domainHash} />
      </dd>
      <dt className="text-slate-600">Message hash</dt>
      <dd>
        <Hash value={hashes.messageHash} />
      </dd>
      <dt className="text-slate-600">SafeMessage hash</dt>
      <dd>
        <Hash value={hashes.safeMessageHash} />
      </dd>
    </dl>
  );
}
