import type { Simulation } from "@/.server/signatures";
import { useOfferWallet } from "@/components/connect-button";
import { AddressLink, CopyButton } from "@/components/hex";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { formatEth } from "@/utils/format";
import { useNavigate } from "@remix-run/react";
import { CheckCircle2, MinusCircle, Send, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
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

export function SimulationResult({ simulation }: { simulation: Simulation }) {
  if (simulation.status === "ok") {
    return (
      <p className="flex items-center gap-2 text-green-700 text-sm" data-testid="simulation-ok">
        <CheckCircle2 className="h-4 w-4" /> Simulated against the latest block: the transaction
        would succeed.
      </p>
    );
  }
  if (simulation.status === "reverted") {
    return (
      <p className="flex items-start gap-2 text-red-700 text-sm" data-testid="simulation-reverted">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Simulated against the latest block: it would revert with{" "}
          <span className="mono">{simulation.error}</span>
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
}: {
  execution: ExecutionLike;
  toLabel?: string;
  title?: string;
  note?: ReactNode;
  extra?: ReactNode;
}) {
  useOfferWallet();
  const { isConnected, connector } = useAccount();
  const { sendTransaction, isPending } = useSendTransaction();
  const navigate = useNavigate();
  // Inside Safe{Wallet} the transaction becomes one of the Safe's own, which its owners confirm
  // and execute there; what comes back is its safeTxHash, not a transaction hash.
  const viaSafe = connector?.id === "safe";
  const [safeTxHash, setSafeTxHash] = useState<Hex | null>(null);

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
          navigate($path("/app/transactions/:hash", { hash }));
        },
        onError: (error) => {
          toast.error(error.message.split("\n")[0] ?? "Transaction rejected", { id: "send-tx" });
        },
      }
    );
  };

  return (
    <div
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      data-testid="execution-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-950">{title}</p>
        <div className="flex items-center gap-2">
          <CopyButton value={execution.data} label="Copy calldata" />
          <Button
            size="sm"
            onClick={send}
            loading={isPending}
            disabled={!isConnected}
            title={isConnected ? undefined : "Connect a wallet to send"}
          >
            <Send /> {viaSafe ? "Create Safe transaction" : "Send transaction"}
          </Button>
        </div>
      </div>
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
      {safeTxHash && (
        <p
          className="rounded-lg bg-green-50 px-3 py-2 text-green-800 text-sm"
          data-testid="safe-tx-created"
        >
          Your Safe has the transaction (safeTxHash{" "}
          <span className="mono break-all">{safeTxHash}</span>). Its owners confirm and execute it
          in Safe{"{"}Wallet{"}"}.
        </p>
      )}
      {extra}
    </div>
  );
}
