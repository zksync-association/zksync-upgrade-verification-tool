import type { Simulation } from "@/.server/signatures";
import { useHoldUpdates, useLive, usePresence, useWatchItem } from "@/components/presence";
import { AddressLink, CopyButton, TxLink } from "@/components/hex";
import { Button } from "@/components/ui/button";
import { usePageNotCurrent } from "@/components/verification/content-currency";
import { cn } from "@/utils/cn";
import { formatEth, formatNumber } from "@/utils/format";
import { Link } from "@remix-run/react";
import { CheckCircle2, Clock, Loader2, MinusCircle, Send, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { $path } from "remix-routes";
import type { Hex } from "viem";
import { useAccount, useSendTransaction } from "wagmi";

export type ExecutionLike = {
  to: string;
  data: string;
  value: string;
  functionName: string;
  simulation?: Simulation | null;
};

// The newest block a simulation's result was read at (a page's is simulated again at each new head
// and the beats name the block), and whether that is the head served now.
export function simulationFreshness(
  simulation: Pick<Simulation, "atBlock" | "watch">,
  live: { head: { number: string } | null; simulatedAt?: Record<string, string> }
): { block: string | null; current: boolean } {
  const at = simulation.atBlock ?? null;
  const again = simulation.watch ? live.simulatedAt?.[simulation.watch.key] : undefined;
  const block = again && at !== null && BigInt(again) > BigInt(at) ? again : at;
  const served = live.head?.number ?? null;
  return { block, current: block === null || served === null || BigInt(block) >= BigInt(served) };
}

// Blocks after sending in which the page's data is read again, until the action shows as done (a
// page also reloads by itself when what it shows changed; this covers the block it lands in).
const RELOAD_BLOCKS_AFTER_SENDING = 30;

/** A transaction sent from this page: its hash, and its receipt one click away. */
export function SentTransaction({ hash }: { hash: Hex }) {
  const { reload } = usePresence();
  const reloadNow = useRef(reload);
  reloadNow.current = reload;
  const head = useLive().head?.number;
  // Counts heads after the one it was sent at: one reload per new block.
  const blocks = useRef(-1);
  useEffect(() => {
    if (head === undefined) return;
    blocks.current += 1;
    if (blocks.current > 0 && blocks.current <= RELOAD_BLOCKS_AFTER_SENDING) reloadNow.current();
  }, [head]);
  return (
    <div
      className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-navy-800 text-sm"
      role="status"
      data-testid="tx-sent"
    >
      <Loader2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-spin" />
      <span className="min-w-0">
        Sent in <TxLink hash={hash} className="text-[13px]" /> · this page shows it done once it is
        in a block.{" "}
        <Link
          to={$path("/app/transactions/:hash", { hash })}
          className="font-medium text-brand-700 hover:underline"
        >
          Its receipt
        </Link>
      </span>
    </div>
  );
}

export function SimulationResult({ simulation }: { simulation: Simulation }) {
  useWatchItem(simulation.watch);
  const live = useLive();
  const { block, current } = simulationFreshness(simulation, live);
  const against = block === null ? "against the latest block" : `at block #${formatNumber(block)}`;
  if (simulation.status === "ok" && current) {
    return (
      <p
        className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-2 font-semibold text-green-900 text-sm"
        data-testid="simulation-ok"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" /> Simulated {against}: the transaction would
        succeed.
      </p>
    );
  }
  if (simulation.status === "ok") {
    // A result from a block before the one served now: said as of that block, never in a passing
    // colour (the next block's simulation replaces it).
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-800 text-sm"
        data-testid="simulation-earlier"
      >
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Simulated {against}: the transaction would have succeeded there.{" "}
          {simulation.watch
            ? `Not simulated at block #${formatNumber(live.head?.number ?? "")} yet; the result there replaces this one.`
            : "Simulate it again for the current block."}
        </span>
      </p>
    );
  }
  if (simulation.status === "reverted") {
    return (
      <p
        className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 px-3 py-2 font-semibold text-red-900 text-sm"
        data-testid="simulation-reverted"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Simulated {against}: it would revert with <span className="mono">{simulation.error}</span>
          {!current && " (not simulated at the current block yet)"}
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-slate-600 text-sm">
      <MinusCircle className="h-4 w-4" /> Not simulated: {simulation.reason}
    </p>
  );
}

export function ExecutionPanel({
  execution,
  toLabel,
  title = "Ready to execute",
  note,
  extra,
  blockedReason = null,
  onSent,
}: {
  execution: ExecutionLike;
  toLabel?: string;
  title?: string;
  note?: ReactNode;
  extra?: ReactNode;
  /** Why sending waits (its signatures not verified at the head served); the panel stays. */
  blockedReason?: string | null;
  /** Sent: the hash goes here (the caller shows it); without it, the panel shows it itself. */
  onSent?: (hash: Hex) => void;
}) {
  const { isConnected, connector } = useAccount();
  const { sendTransaction, isPending } = useSendTransaction();
  const [sent, setSent] = useState<Hex | null>(null);
  // Inside Safe{Wallet} the transaction becomes one of the Safe's own, which its owners confirm
  // and execute there; what comes back is its safeTxHash, not a transaction hash.
  const viaSafe = connector?.id === "safe";
  const [safeTxHash, setSafeTxHash] = useState<Hex | null>(null);
  // While the wallet request is pending, or the Safe transaction hash is shown (until dismissed),
  // the page's data is not reloaded.
  const waiting = useHoldUpdates(isPending || safeTxHash !== null);
  // The signatures it carries or the page's own item not current at the head served: sending waits.
  const page = usePageNotCurrent();
  const blocked =
    blockedReason !== null
      ? {
          reason: blockedReason,
          waits: "Sending waits until the signatures are verified at the current block.",
        }
      : page;

  const send = () => {
    toast.loading(
      viaSafe
        ? "Review the transaction in Safe{Wallet}…"
        : "Confirm the transaction in your wallet…",
      { id: "send-tx" }
    );
    sendTransaction(
      { to: execution.to as Hex, data: execution.data as Hex, value: BigInt(execution.value) },
      {
        onSuccess: (hash) => {
          if (viaSafe) {
            toast.success("Your Safe has the transaction", { id: "send-tx" });
            setSafeTxHash(hash);
            return;
          }
          toast.success("Transaction sent", { id: "send-tx" });
          // The page stays: it shows the action done once the transaction is in a block.
          if (onSent) onSent(hash);
          else setSent(hash);
        },
        onError: (error) => {
          toast.error(error.message.split("\n")[0] ?? "Transaction rejected", { id: "send-tx" });
        },
      }
    );
  };

  return (
    <div
      className="space-y-3 rounded-xl border border-brand-200 bg-brand-25 p-5"
      data-testid="execution-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-lg text-navy-800">{title}</p>
        <div className="flex items-center gap-2">
          <CopyButton value={execution.data} label="Copy calldata" />
          <Button
            size="sm"
            onClick={send}
            loading={isPending}
            disabled={!isConnected || (blocked !== null && !isPending)}
            title={blocked?.reason ?? (isConnected ? undefined : "Connect a wallet to send")}
            data-testid="send-transaction"
          >
            <Send /> {viaSafe ? "Create Safe transaction" : "Send transaction"}
          </Button>
        </div>
      </div>
      {blocked && (
        <p className="text-slate-700 text-xs" role="status" data-testid="send-blocked">
          {blocked.reason} {blocked.waits}
        </p>
      )}
      <p className="text-slate-950 text-sm">
        {note ??
          "Anyone can send this transaction: the contract checks the signatures, not the sender."}
      </p>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="text-slate-600">To</dt>
        <dd className="min-w-0">
          <AddressLink address={execution.to} label={toLabel} />
        </dd>
        <dt className="text-slate-600">Value</dt>
        <dd>{formatEth(execution.value)}</dd>
        <dt className="text-slate-600">Function</dt>
        <dd className="mono">{execution.functionName}</dd>
        <dt className="text-slate-600">Calldata</dt>
        <dd className="min-w-0">
          <pre
            className={cn(
              "mono max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-white p-3"
            )}
            data-testid="calldata"
          >
            {execution.data}
          </pre>
        </dd>
      </dl>
      {execution.simulation && <SimulationResult simulation={execution.simulation} />}
      {sent && <SentTransaction hash={sent} />}
      {safeTxHash && (
        <div
          className="space-y-2 rounded-lg bg-green-50 px-3 py-2 text-green-900 text-sm"
          data-testid="safe-tx-created"
        >
          <p>
            Your Safe has the transaction (safeTxHash{" "}
            <span className="mono break-all">{safeTxHash}</span>). Its owners confirm and execute it
            in Safe{"{"}Wallet{"}"}.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {waiting && (
              <span className="text-slate-700 text-xs" role="status" data-testid="update-held">
                New data · applies when you close this
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSafeTxHash(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
      {extra}
    </div>
  );
}
