import { numberToHex, parseEther } from "viem";
import { z } from "zod";
import { addressSchema, hexSchema } from "@/common/basic-schemas";

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

