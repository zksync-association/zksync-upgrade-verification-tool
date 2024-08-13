import { type Hex, getAddress } from "viem";
import { z } from "zod";

const hexRegexp = /0x[0-9a-fA-F]*/;

const hexChars = z.string().refine((str) => hexRegexp.test(str), "Not a valid hex");

export const hexSchema = hexChars.transform((str) => str as Hex);
export const addressSchema = hexChars
  .refine((str) => str.length === 42, "Address have to be 20 bytes long")
  .transform((str) => getAddress(str));
