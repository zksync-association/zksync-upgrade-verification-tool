import { addressSchema, hexSchema } from "@repo/common/schemas";
import { numberToHex, parseEther } from "viem";
import { z } from "zod";

export const callSchema = z.object({
  target: hexSchema,
  data: hexSchema,
  value: hexSchema,
});

export type Call = z.infer<typeof callSchema>;

export const formCallSchemaWithoutObject = {
  target: addressSchema,
  data: hexSchema,
  value: z.coerce
    .number()
    .transform((n) => n.toString())
    .transform((str) => numberToHex(parseEther(str))),
};

export const formCallSchema = z.object(formCallSchemaWithoutObject);
