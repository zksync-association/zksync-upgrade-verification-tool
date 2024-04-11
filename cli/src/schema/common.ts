import { z } from "zod";
export const hashString = z.string().regex(/^0x[a-fA-F0-9]*$/, "Invalid hex encoded hash");

export const account20String = hashString.length(42, "Invalid Ethereum address");
export const bytes32Hash = hashString.length(66, "Invalid Ethereum word");
export const selectorhash = hashString.length(10, "Invalid Selector hash");

export const numberString = z.string().regex(/^[0-9]*$/, "Invalid number");

export const transactionSchema = z.object({
  txType: z.number(),
  from: account20String,
  to: account20String,
  gasLimit: z.number(),
  gasPerPubdataByteLimit: z.number(),
  maxFeePerGas: z.number(),
  maxPriorityFeePerGas: z.number(),
  paymaster: z.number(),
  nonce: z.union([numberString, z.number()]),
  value: z.number(),
  reserved: z.array(z.number()),
  data: hashString,
  signature: hashString,
  factoryDeps: z.array(z.string()),
  paymasterInput: hashString,
  reservedDynamic: hashString,
});
