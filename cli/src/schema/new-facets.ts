import { z } from "zod";
import { zodHex } from "./hex-parser";

export const facetsResponseSchema = z.array(
  z.object({
    addr: zodHex,
    selectors: z.array(zodHex),
  })
);
// export type NewFacet = z.infer<typeof facetsResponseSchema>
