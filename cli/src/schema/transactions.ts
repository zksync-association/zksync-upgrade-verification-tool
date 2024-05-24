import { z } from "zod";
import {
  account20String,
  bytes32Hash,
  hashString,
  transactionSchema,
} from "../schema";
import { facetCutsSchema } from "./facetCuts";

export const verifierParamsSchema = z.object({
  recursionNodeLevelVkHash: bytes32Hash,
  recursionLeafLevelVkHash: bytes32Hash,
  recursionCircuitsSetVksHash: bytes32Hash,
});


export const transactionsSchema = z.object({
  proposeUpgradeTx: z.object({
    l2ProtocolUpgradeTx: transactionSchema,
    bootloaderHash: bytes32Hash,
    defaultAccountHash: bytes32Hash,
    verifier: account20String,
    verifierParams: verifierParamsSchema,
    l1ContractsUpgradeCalldata: hashString,
    postUpgradeCalldata: hashString,
    upgradeTimestamp: z.object({
      type: z.literal("BigNumber"),
      hex: hashString,
    }),
    factoryDeps: z.array(z.string()),
    newProtocolVersion: z.string(),
    newAllowList: account20String,
  }),
  l1upgradeCalldata: hashString,
  upgradeAddress: account20String,
  protocolVersion: z.string(),
  upgradeTimestamp: z.string(),
  scheduleTransparentOperation: z.optional(hashString),
  executeOperation: z.optional(hashString),
  governanceOperation: z.optional(
    z.object({
      calls: z.array(
        z.object({
          target: account20String,
          value: z.number(),
          data: hashString,
        })
      ),
      predecessor: bytes32Hash,
      salt: bytes32Hash,
    })
  ),
  transparentUpgrade: z.object({
    facetCuts: facetCutsSchema,
    initAddress: account20String,
    initCalldata: hashString,
  }),
});

export type TransactionsJson = z.infer<typeof transactionsSchema>;
