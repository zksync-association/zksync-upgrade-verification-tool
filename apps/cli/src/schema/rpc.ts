import { z } from "zod";
import { zodOptional } from "./zod-optionals.js";
import { zodHex } from "./hex-parser.js";

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: zodOptional(z.number()),
    storage: zodOptional(z.record(z.string(), zodHex)),
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
      initCalldata: zodHex,
    }),
  ]),
});

export const upgradeCallDataSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.object({
      l2ProtocolUpgradeTx: z.object({
        to: z.bigint(),
        from: z.bigint(),
        data: zodHex,
      }),
      factoryDeps: z.array(z.any()),
      bootloaderHash: zodHex,
      defaultAccountHash: zodHex,
      verifier: zodHex,
      verifierParams: z.any(),
      l1ContractsUpgradeCalldata: z.string(),
      postUpgradeCalldata: zodHex,
      upgradeTimestamp: z.bigint(),
      newProtocolVersion: z.bigint(),
    }),
  ]),
});

export const l2UpgradeSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.array(
      z.object({
        bytecodeHash: zodHex,
        newAddress: zodHex,
        callConstructor: z.boolean(),
        value: z.bigint(),
        input: z.string(),
      })
    ),
  ]),
});

export const contractEventSchema = z.object({
  address: zodHex,
  topics: z.array(zodHex),
  data: zodHex,
  transactionHash: zodHex,
  blockNumber: zodHex,
});

const baseCallTracerSchema = z.object({
  from: z.string(),
  to: z.string(),
  input: z.string(),
});

export type CallTrace = z.infer<typeof baseCallTracerSchema> & {
  calls?: CallTrace[];
};

export const callTracerSchema: z.ZodType<CallTrace> = baseCallTracerSchema.extend({
  calls: z.lazy(() => callTracerSchema.array().optional()),
});

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>;
export type FacetCut = z.infer<typeof facetCutSchema>;
export type ContractEvent = z.infer<typeof contractEventSchema>;
