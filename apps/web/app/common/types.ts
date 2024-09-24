import type { Hex } from "viem";

export type StartUpgradeData = {
  l2BatchNumber: Hex;
  l2MessageIndex: Hex;
  l2TxNumberInBatch: Hex;
  proof: Hex[];
  proposal: Hex;
};