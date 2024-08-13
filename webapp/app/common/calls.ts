import { type Hex, getAddress, parseEther, numberToHex } from "viem";
import { z } from "zod";

const hexRegexp = /0x[0-9a-fA-F]*/;

const hexChars = z.string().refine((str) => hexRegexp.test(str), "Not a valid hex");

export const hexSchema = hexChars
  .transform((str) => str as Hex);

const digitsSchema = z.string().refine((str) => /[0-9]+/.test(str), "Not a numerical string");

export const addressSchema = hexChars
  .refine((str) => str.length === 42, "Address have to be 20 bytes long")
  .transform((str) => getAddress(str));

export const callSchema = z.object({
  target: hexSchema,
  data: hexSchema,
  value: hexSchema,
});

export type Call = z.infer<typeof callSchema>;

export const formCallSchema = z.object({
  target: addressSchema,
  data: hexSchema,
  value: z.string()
  .refine((str) => !isNaN(parseFloat(str)), "Should be a valid number")
  .transform((str) => numberToHex(parseEther(str)))
});

