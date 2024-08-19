import { displayBytes32 } from "@/routes/app/proposals/$id/common-tables";
import { getTransactionUrl } from "@/utils/etherscan";
import { SquareArrowOutUpRight } from "lucide-react";
import type { Hex } from "viem";

import type { EthNetwork } from "@/common/eth-network-enum";

type TxLinkProps = { hash: Hex; network: EthNetwork };

export default function TxLink({ hash, network }: TxLinkProps) {
  return (
    <a
      href={getTransactionUrl(hash, network)}
      className="flex items-center justify-end break-words underline"
      target="_blank"
      rel="noreferrer"
    >
      <span>{displayBytes32(hash)}</span>
      <SquareArrowOutUpRight
        className="ml-1"
        width={12}
        height={12}
        data-testid="square-arrow-out-up-right-icon"
      />
    </a>
  );
}
