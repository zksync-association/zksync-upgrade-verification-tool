import { loaderRevs } from "@/.server/sync/content";
import {
  type ReceiptAnswer,
  pageReceipt,
  receiptContent,
  receiptFollowed,
} from "@/.server/sync/receipt";
import { watchItems, watchKeys } from "@/.server/sync/presence";
import { useStatus } from "@/components/governance-context";
import { TxLink } from "@/components/hex";
import { PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
import { AsOfContent } from "@/components/verification/as-of";
import { NotReReadNote, useContentCurrency } from "@/components/verification/content-currency";
import { formatEth } from "@/utils/format";
import { notFound } from "@/utils/http";
import { Meta } from "@/utils/meta";
import { requestStatusRevalidation } from "@/utils/revalidation";
import { type LoaderFunctionArgs, defer } from "@remix-run/node";
import { Await, useLoaderData, useRevalidator } from "@remix-run/react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import type { Hex } from "viem";

export const meta = Meta["/app/transactions/:hash"];

// Receipt read on the server through the app's RPC. While the page is on screen and the
// transaction is not mined (or mined in a block that is not final yet), the sync engine reads the
// receipt once per new block, and the page reloads (from memory) when it changed: the page itself
// polls nothing. A receipt found in a final block is kept (sync/receipt.ts); a later read that
// fails never turns the page back into "waiting", a read that fails is said as such, and one that
// no longer finds a receipt found before (a reorg) says it could not be read, never "not mined".
// Deferred: the page is sent before the RPC answers.
export function loader({ params, request }: LoaderFunctionArgs) {
  const hash = params.hash ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw notFound();
  const receipt = pageReceipt(hash as Hex);
  return defer({
    watch: watchItems(request, [watchKeys.tx(hash)]),
    revs: loaderRevs([[watchKeys.tx(hash), receipt.then(receiptContent)]]),
    hash,
    receipt,
    // Read again at each new block while the page is open (not on a dev node, not when the app
    // does not follow the chain): the waiting text says which.
    followed: receiptFollowed(),
  });
}

/** The receipt, once mined; null while it is not, or when it could not be read (`unread`). */
type Receipt = NonNullable<ReceiptAnswer["receipt"]> | null;

const STATUS_READ_MS = 4_000;
// Root status reads at most, once mined, while it is still older than the transaction's block
// (the server's head can trail the receipt by a moment).
const STATUS_READS = 3;

export default function Transaction() {
  const { hash, receipt, followed } = useLoaderData<typeof loader>();
  // A receipt not read again at the head served now: as of its block, in no colour.
  const stale = useContentCurrency(`tx:${hash.toLowerCase()}`).behind !== null;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Transaction" title="Transaction" id={hash} />
      {/* A receipt not read again at the head served now: as of its block. */}
      <NotReReadNote watchKey={`tx:${hash.toLowerCase()}`} what="The receipt's status below" />
      <Suspense
        fallback={
          <Card className="p-6">
            <p role="status" className="flex items-center gap-2 text-slate-950">
              <Clock className="h-5 w-5 text-slate-600" /> Reading the transaction receipt…
            </p>
          </Card>
        }
      >
        <Await resolve={receipt}>
          {(answer) => (
            <AsOfContent asOf={null} stale={stale}>
              <TransactionStatus
                hash={hash}
                receipt={answer.receipt as Receipt}
                unread={answer.unread}
                followed={followed}
              />
            </AsOfContent>
          )}
        </Await>
      </Suspense>
    </div>
  );
}

function TransactionStatus({
  hash,
  receipt,
  unread,
  followed,
}: {
  hash: string;
  receipt: Receipt;
  unread: boolean;
  followed: Promise<boolean> | boolean;
}) {
  const { governance } = useStatus();
  const revalidator = useRevalidator();

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
      reads.count === 0 ? 0 : STATUS_READ_MS
    );
    return () => clearTimeout(timer);
  }, [statusBehind, revalidator]);

  return (
    <Card className="p-6">
      {!receipt ? (
        <p className="flex items-center gap-2 text-slate-950">
          <Clock className="h-5 w-5 text-slate-600" />
          <span>
            {unread
              ? "Could not read the transaction receipt through your RPC"
              : "Waiting for the transaction to be mined"}{" "}
            <Suspense fallback={null}>
              <Await resolve={followed} errorElement={<>(reload the page to check again)</>}>
                {(followed) =>
                  followed
                    ? "(checked at each new block while this page is open)"
                    : "(reload the page to check again)"
                }
              </Await>
            </Suspense>
            .{" "}
            {!unread && (
              <>
                If you sent it from a Safe, this may be a Safe transaction hash; follow it in Safe
                {"{"}Wallet{"}"}.
              </>
            )}
          </span>
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
            {receipt.status === "success" ? "Succeeded" : "Reverted"} in block {receipt.blockNumber}
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
  );
}
