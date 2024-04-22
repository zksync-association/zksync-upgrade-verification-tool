import {z} from "zod";


export const executeUpgradeSchema = z.object({
  functionName: z.string(),
  args: z.array(z.object({
    facetCuts: z.array(z.object({
      facet: z.string(),
      action: z.number(),
      isFreezable: z.boolean(),
      selectors: z.array(z.string())
    })),
    initAddress: z.string(),
    initCalldata: z.string()
  }))
})
