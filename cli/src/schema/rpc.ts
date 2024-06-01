import { z } from "zod"

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: z.optional(z.number()),
    storage: z.optional(z.record(z.string(), z.string()))
  })
)

export const memoryDiffParser = z.object({
  result: z.object({
    post: stateParser,
    pre: stateParser
  })
})

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>