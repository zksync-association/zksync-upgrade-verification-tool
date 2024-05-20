import { z } from "zod"

export const compiledArtifactParser = z.object({
  bytecode: z.string(),
  abi: z.array(z.any())
})