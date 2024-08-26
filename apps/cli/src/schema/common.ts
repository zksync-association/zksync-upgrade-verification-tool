import { z } from "zod";
import { addressSchema, hexSchema } from "@repo/common/schemas";

export const numericString = z.string().regex(/^[0-9]*$/, "Invalid number");

export const transactionSchema = z.object({
  txType: z.number(),
  from: addressSchema,
  to: addressSchema,
  gasLimit: z.number(),
  gasPerPubdataByteLimit: z.number(),
  maxFeePerGas: z.number(),
  maxPriorityFeePerGas: z.number(),
  paymaster: z.number(),
  nonce: z.union([numericString, z.number()]),
  value: z.number(),
  reserved: z.array(z.number()),
  data: hexSchema,
  signature: hexSchema,
  factoryDeps: z.array(z.string()),
  paymasterInput: hexSchema,
  reservedDynamic: hexSchema,
});
