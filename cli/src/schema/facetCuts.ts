import { z } from "zod";
import {  hashString, selectorHash } from "../schema";

export const facetCutsSchema = z.array(
  z.object({
    facet: hashString,
    selectors: z.array(selectorHash),
    action: z.number(),
    isFreezable: z.boolean(),
  })
);
