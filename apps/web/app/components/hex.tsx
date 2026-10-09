import { ChainContext, GovernanceContext } from "@/components/governance-context";
import { cn } from "@/utils/cn";
import { shortHex } from "@/utils/format";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useContext, useState } from "react";

export function CopyButton({
  value,
  className,
  label,
}: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopyError(false);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopyError(true);
        }
      }}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 sm:h-8 sm:w-8",
        className
      )}
      aria-label={copied ? "Copied" : label ?? "Copy"}
      title={
        copyError
          ? "Copy failed. Select the value and copy it manually."
          : copied
            ? "Copied"
            : label ?? "Copy"
      }
    >
      <span className="sr-only" role="status">
        {copyError
          ? "Copy failed. Select the value and copy it manually."
          : copied
            ? "Copied to clipboard"
            : ""}
      </span>
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** A hash shown in full: signers compare these character by character with their device. */
export function Hash({
  value,
  className,
  copy = true,
}: { value: string; className?: string; copy?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-1", className)}>
      <span className="mono min-w-0 break-all rounded-md border border-slate-200 bg-slate-75 px-2 py-1 font-medium text-slate-950">
        {value}
      </span>
      {copy && <CopyButton value={value} label="Copy hash" />}
    </span>
  );
}

export function useExplorer() {
  // The chain the app shell was set up for (known before the status is read), or the network of
  // a status in hand.
  const chain = useContext(ChainContext);
  const status = useContext(GovernanceContext);
  const network = chain ?? status?.governance.network ?? null;
  return {
    address: (a: string) => (network?.explorerUrl ? `${network.explorerUrl}/address/${a}` : null),
    tx: (h: string) => (network?.explorerUrl ? `${network.explorerUrl}/tx/${h}` : null),
    l2Address: (a: string) =>
      network?.l2ExplorerUrl ? `${network.l2ExplorerUrl}/address/${a}` : null,
    l2Tx: (h: string) => (network?.l2ExplorerUrl ? `${network.l2ExplorerUrl}/tx/${h}` : null),
    block: (n: string) => (network?.explorerUrl ? `${network.explorerUrl}/block/${n}` : null),
  };
}

export function ExternalAnchor({
  href,
  children,
  className,
}: { href: string | null; children: React.ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-brand-700 hover:underline",
        className
      )}
    >
      <span className="min-w-0 break-all">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export function AddressLink({
  address,
  label,
  full = true,
  className,
  l2,
}: {
  address: string;
  label?: string | null;
  full?: boolean;
  className?: string;
  l2?: boolean;
}) {
  const explorer = useExplorer();
  const href = l2 ? explorer.l2Address(address) : explorer.address(address);
  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}
      title={address}
    >
      {label && <span className="font-medium text-slate-950">{label}</span>}
      <ExternalAnchor
        href={href}
        className={cn("mono", !label && "text-slate-950", label && "text-slate-600")}
      >
        {full ? address : shortHex(address)}
      </ExternalAnchor>
      <CopyButton value={address} />
    </span>
  );
}

export function TxLink({
  hash,
  l2,
  className,
}: { hash: string; l2?: boolean; className?: string }) {
  const explorer = useExplorer();
  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full items-start gap-1", className)}
      title={hash}
    >
      <ExternalAnchor href={l2 ? explorer.l2Tx(hash) : explorer.tx(hash)} className="mono">
        {hash}
      </ExternalAnchor>
      <CopyButton value={hash} />
    </span>
  );
}
