import { z } from "zod";
import { account20String, bytes32Hash } from "./common";
import { facetCutsSchema } from "./facetCuts";

export const verifierParamsSchema = z.object({
  recursionNodeLevelVkHash: bytes32Hash,
  recursionLeafLevelVkHash: bytes32Hash,
  recursionCircuitsSetVksHash: bytes32Hash,
});

export const transactionsSchema = z.object({
  proposeUpgradeTx: z.object({
    bootloaderHash: bytes32Hash,
    defaultAccountHash: bytes32Hash,
    verifier: account20String,
    verifierParams: verifierParamsSchema,
  }),
  transparentUpgrade: z.object({
    facetCuts: facetCutsSchema,
  }),
  governanceOperation: z.optional(
    z.object({
      calls: z.array(
        z.object({
          target: z.string(),
          data: z.string(),
        })
      ),
    })
  ),
});

export type TransactionsJson = z.infer<typeof transactionsSchema>;
