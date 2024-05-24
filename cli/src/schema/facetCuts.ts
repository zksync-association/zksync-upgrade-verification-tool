import { z } from "zod";
import { account20String, selectorHash } from "../schema";

export const facetCutsSchema = z.array(
  z.object({
    facet: account20String,
    selectors: z.array(selectorHash),
    action: z.number(),
    isFreezable: z.boolean(),
  })
);

