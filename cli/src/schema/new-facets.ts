import { z } from "zod";

export const facetsResponseSchema = z.array(
  z.object({
    addr: z.string(),
    selectors: z.array(z.string()),
  })
);

// export type NewFacet = z.infer<typeof facetsResponseSchema>
