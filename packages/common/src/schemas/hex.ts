import { type Hex, getAddress } from "viem";
import { z } from "zod";

export const hexRegex = /^0x[0-9a-fA-F]*$/;

export const hexSchema = z
  .string()
  .refine((str) => hexRegex.test(str), "Not a valid hex")
  .transform((str) => str as Hex);

export const addressSchema = hexSchema
  .refine((str) => str.length === 42, "Address has to be 20 bytes long")
  .transform((str) => getAddress(str));

export const bytes32Schema = hexSchema.refine((str) => str.length === 66, "Invalid Ethereum word");

export const selectorSchema = hexSchema.refine((str) => str.length === 10, "Invalid Selector hash");
export type Selector = z.infer<typeof selectorSchema>;
