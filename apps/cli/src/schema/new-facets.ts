import { addressSchema, selectorSchema } from "@repo/common/schemas";
import { z } from "zod";

export const facetsResponseSchema = z.array(
  z.object({
    addr: addressSchema,
    selectors: z.array(selectorSchema),
  })
);
// export type NewFacet = z.infer<typeof facetsResponseSchema>
