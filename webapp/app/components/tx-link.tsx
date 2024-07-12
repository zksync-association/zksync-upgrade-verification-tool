import { displayBytes32 } from "@/routes/app/proposals.$id/common-tables";
import { getTransactionUrl } from "@/utils/etherscan";
import { SquareArrowOutUpRight } from "lucide-react";
import type { Hex } from "viem";

export default function TxLink({ txid }: { txid: Hex }) {
  return (
    <a
      href={getTransactionUrl(txid as Hex)}
      className="flex w-1/2 items-center justify-end break-words underline"
      target="_blank"
      rel="noreferrer"
    >
      <span>{displayBytes32(txid)}</span>
      <SquareArrowOutUpRight className="ml-1" width={12} height={12} />
    </a>
  );
}
