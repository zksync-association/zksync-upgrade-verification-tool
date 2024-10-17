import { addressSchema, hexSchema } from "@repo/common/schemas";
import { numberToHex, parseEther } from "viem";
import { z } from "zod";
export { callSchema, type Call } from "@repo/common/schemas"

export const formCallSchemaWithoutObject = {
  target: addressSchema,
  data: hexSchema,
  value: z.coerce
    .number()
    .transform((n) => n.toString())
    .transform((str) => numberToHex(parseEther(str))),
};

