import { displayBytes32 } from "@/routes/app/proposals/$id/common-tables";
import { getTransactionUrl } from "@/utils/etherscan";
import { SquareArrowOutUpRight } from "lucide-react";
import type { Hex } from "viem";

import { EthNetwork } from "@/common/eth-network-enum";

type TxLinkProps = { txid: Hex, network: EthNetwork };

export default function TxLink({ txid, network }: TxLinkProps) {
  return (
    <a
      href={getTransactionUrl(txid as Hex, network)}
      className="flex w-1/2 items-center justify-end break-words underline"
      target="_blank"
      rel="noreferrer"
    >
      <span>{displayBytes32(txid)}</span>
      <SquareArrowOutUpRight
        className="ml-1"
        width={12}
        height={12}
        data-testid="square-arrow-out-up-right-icon"
      />
    </a>
  );
}
