import { l1 } from "@/.server/rpc";
import { useStatus } from "@/components/governance-context";
import { TxLink } from "@/components/hex";
import { PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
import { formatEth } from "@/utils/format";
import { notFound } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { requestStatusRevalidation } from "@/utils/revalidation";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Hex } from "viem";

export const meta = Meta["/app/transactions/:hash"];

// Receipt read on the server through the app's RPC, polled until mined.
export async function loader({ params }: LoaderFunctionArgs) {
  const hash = params.hash ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw notFound();
  const receipt = await l1.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
  return json({
    hash,
    receipt: receipt && {
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      from: receipt.from,
      to: receipt.to,
      fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    },
  });
}

const POLL_MS = 4_000;
// Root status reads at most, once mined, while it is still older than the transaction's block
// (the server's head can trail the receipt by a moment).
const STATUS_READS = 3;

export default function Transaction() {
  const { hash, receipt } = useLoaderData<typeof loader>();
  const { governance } = useStatus();
  const revalidator = useRevalidator();
  // Until mined, poll for the receipt. These polls leave the app status alone.
  useEffect(() => {
    if (receipt) return;
    const timer = setInterval(
      () => revalidator.state === "idle" && revalidator.revalidate(),
      POLL_MS
    );
    return () => clearInterval(timer);
  }, [receipt, revalidator]);

  // Once mined, the app status other pages read (freeze state and nonces, members, thresholds)
  // predates the transaction until it is read at or after its block: read it again, right away
  // and then every poll interval while it still is, a few times at most.
  const statusBehind =
    receipt !== null && BigInt(receipt.blockNumber) > BigInt(governance.latestBlock.number);
  const statusReads = useRef({ hash, count: 0 });
  if (statusReads.current.hash !== hash) statusReads.current = { hash, count: 0 };
  useEffect(() => {
    const reads = statusReads.current;
    if (!statusBehind || revalidator.state !== "idle" || reads.count >= STATUS_READS) return;
    const timer = setTimeout(
      () => {
        reads.count += 1;
        requestStatusRevalidation();
        revalidator.revalidate();
      },
      reads.count === 0 ? 0 : POLL_MS
    );
    return () => clearTimeout(timer);
  }, [statusBehind, revalidator]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Transaction" title="Transaction" id={hash} />
      <Card className="p-6">
        {!receipt ? (
          <p className="flex items-center gap-2 text-slate-950">
            <Clock className="h-5 w-5 text-slate-600" /> Waiting for the transaction to be mined… If
            you sent it from a Safe, this may be a Safe transaction hash; follow it in Safe{"{"}
            Wallet{"}"}.
          </p>
        ) : (
          <div className="space-y-4">
            <p
              className={`flex items-center gap-2 font-medium ${receipt.status === "success" ? "text-green-900" : "text-red-800"}`}
            >
              {receipt.status === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              {receipt.status === "success" ? "Succeeded" : "Reverted"} in block{" "}
              {receipt.blockNumber}
            </p>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-slate-600">Hash</dt>
              <dd>
                <TxLink hash={hash} />
              </dd>
              <dt className="text-slate-600">From</dt>
              <dd className="mono">{receipt.from}</dd>
              <dt className="text-slate-600">To</dt>
              <dd className="mono">{receipt.to}</dd>
              <dt className="text-slate-600">Fee</dt>
              <dd>{formatEth(receipt.fee)}</dd>
            </dl>
          </div>
        )}
      </Card>
    </div>
  );
}
