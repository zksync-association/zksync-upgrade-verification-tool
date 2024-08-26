import { addressSchema, selectorSchema } from "@repo/common/schemas";
import { z } from "zod";

export const facetCutsSchema = z.array(
  z.object({
    facet: addressSchema,
    selectors: z.array(selectorSchema),
    action: z.number(),
    isFreezable: z.boolean(),
  })
);
