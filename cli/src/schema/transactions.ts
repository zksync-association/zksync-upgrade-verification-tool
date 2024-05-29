import { z } from "zod";
import { account20String, bytes32Hash, hashString, transactionSchema } from "../schema";
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
});

export type TransactionsJson = z.infer<typeof transactionsSchema>;
