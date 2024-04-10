import { z } from "zod";
import { account20String, selectorhash } from "../schema";

export const facetCutsSchema = z.array(
  z.object({
    facet: account20String,
    selectors: z.array(selectorhash),
    action: z.number(),
    isFreezable: z.boolean(),
  })
);

export type FacetCutsJson = z.infer<typeof facetCutsSchema>;
