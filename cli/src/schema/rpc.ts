import {z} from "zod";
import { zodOptional } from "./zod-optionals";
import {zodHex} from "./hex-parser";

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

const facetCutSchema = z.object({
  facet: zodHex,
  action: z.number(),
  isFreezable: z.boolean(),
  selectors: z.array(zodHex),
});

export const callDataSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.object({
      facetCuts: z.array(facetCutSchema),
      initAddress: zodHex,
      initCalldata: zodHex
    })
  ])
})

export const upgradeCallDataSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.object({
      l2ProtocolUpgradeTx: z.any(),
      factoryDeps: z.array(z.any()),
      bootloaderHash: zodHex,
      defaultAccountHash: zodHex,
      verifier: zodHex,
      verifierParams: z.any(),
      l1ContractsUpgradeCalldata: z.string(),
      postUpgradeCalldata: zodHex,
      upgradeTimestamp: z.bigint(),
      newProtocolVersion: z.bigint()
    })
  ])
})

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>;
export type FacetCut = z.infer<typeof facetCutSchema>