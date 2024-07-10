import type { Hex } from "viem";

export function getTransactionUrl(transactionHash: Hex) {
  return `https://etherscan.io/tx/${transactionHash}`;
}
