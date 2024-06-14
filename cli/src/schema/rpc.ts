import { z } from "zod";
import { zodOptional } from "./zod-optionals";

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: zodOptional(z.number()),
    storage: zodOptional(z.record(z.string(), z.string())),
  })
);

export const memoryDiffParser = z.object({
  result: z.object({
    post: stateParser,
    pre: stateParser,
  }),
});

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>;
