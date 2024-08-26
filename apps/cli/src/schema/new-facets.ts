import { z } from "zod";
import { zodHex } from "./hex-parser.js";

export const facetsResponseSchema = z.array(
  z.object({
    addr: zodHex,
    selectors: z.array(zodHex),
  })
);
// export type NewFacet = z.infer<typeof facetsResponseSchema>
