import { addressSchema, hexSchema } from "@/common/basic-schemas";
import { numberToHex, parseEther } from "viem";
import { z } from "zod";

export const callSchema = z.object({
  target: hexSchema,
  data: hexSchema,
  value: hexSchema,
});

export type Call = z.infer<typeof callSchema>;

export const formCallSchema = z.object({
  target: addressSchema,
  data: hexSchema,
  value: z
    .coerce
    .number()
    .transform(n => n.toString())
    .transform((str) => numberToHex(parseEther(str))),
});
