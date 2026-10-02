import { l1 } from "@/.server/rpc";
import { TxLink } from "@/components/hex";
import { PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
import { formatEth } from "@/utils/format";
import { notFound } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useEffect } from "react";
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

export default function Transaction() {
  const { hash, receipt } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (receipt) return;
    const timer = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), 4000);
    return () => clearInterval(timer);
  }, [receipt, revalidator]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Transaction" title="Transaction" id={hash} />
      <Card className="p-6">
        {!receipt ? (
          <p className="flex items-center gap-2 text-slate-950">
            <Clock className="h-5 w-5 text-slate-500" /> Waiting for the transaction to be mined… If
            you sent it from a Safe, this may be a Safe transaction hash; follow it in Safe{"{"}
            Wallet{"}"}.
          </p>
        ) : (
          <div className="space-y-4">
            <p
              className={`flex items-center gap-2 font-medium ${receipt.status === "success" ? "text-green-700" : "text-red-700"}`}
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
