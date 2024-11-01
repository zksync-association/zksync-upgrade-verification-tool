import { z } from "zod";
import { facetCutsSchema } from "./facetCuts.js";
import { addressSchema, bytes32Schema, hexSchema } from "@repo/common/schemas";

export const verifierParamsSchema = z.object({
  recursionNodeLevelVkHash: bytes32Schema,
  recursionLeafLevelVkHash: bytes32Schema,
  recursionCircuitsSetVksHash: bytes32Schema,
});

export const transactionsSchema = z.object({
  proposeUpgradeTx: z.object({
    bootloaderHash: bytes32Schema,
    defaultAccountHash: bytes32Schema,
    verifier: addressSchema,
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
          data: hexSchema,
        })
      ),
    })
  ),
});

export type TransactionsJson = z.infer<typeof transactionsSchema>;
