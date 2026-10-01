import type { RootLoader } from "@/root";
import { cn } from "@/utils/cn";
import { shortHex } from "@/utils/format";
import { useRouteLoaderData } from "@remix-run/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

export function CopyButton({
  value,
  className,
  label,
}: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-75 hover:text-slate-950",
        className
      )}
      aria-label={label ?? "Copy"}
      title={label ?? "Copy"}
    >
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
      <span className="mono min-w-0 break-all text-slate-950">{value}</span>
      {copy && <CopyButton value={value} className="-mt-0.5" />}
    </span>
  );
}

export function ShortHash({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={value}>
      <span className="mono text-slate-950">{shortHex(value, 10, 8)}</span>
      <CopyButton value={value} />
    </span>
  );
}

export function useExplorer() {
  const data = useRouteLoaderData<RootLoader>("root");
  const network = data?.status.ok ? data.status.governance.network : null;
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
      className={cn("inline-flex items-center gap-1 text-brand-600 hover:underline", className)}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export function AddressLink({
  address,
  label,
  full,
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
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={address}>
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
    <span className={cn("inline-flex items-center gap-1", className)} title={hash}>
      <ExternalAnchor href={l2 ? explorer.l2Tx(hash) : explorer.tx(hash)} className="mono">
        {shortHex(hash, 10, 8)}
      </ExternalAnchor>
      <CopyButton value={hash} />
    </span>
  );
}
