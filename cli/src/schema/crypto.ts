import { z } from "zod";
import { account20String, bytes32Hash } from "../schema";

export const verifierParamsSchema = z.object({
  recursionNodeLevelVkHash: bytes32Hash,
  recursionLeafLevelVkHash: bytes32Hash,
  recursionCircuitsSetVksHash: bytes32Hash,
});

export const cryptoSchema = z.object({
  verifier: z.object({ address: account20String, txHash: bytes32Hash }).optional(),
  keys: verifierParamsSchema.optional(),
});

export type CryptoJson = z.infer<typeof cryptoSchema>;
export const ALL_VERIFIER_PARAMS = ['recursionNodeLevelVkHash', 'recursionLeafLevelVkHash', 'recursionCircuitsSetVksHash'] as const