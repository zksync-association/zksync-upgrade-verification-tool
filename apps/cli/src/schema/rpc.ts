import { z } from "zod";
import { zodOptional } from "./zod-optionals.js";
import { hexSchema } from "@repo/common/schemas";

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: zodOptional(z.number()),
    storage: zodOptional(z.record(z.string(), hexSchema)),
  })
);

export const memoryDiffParser = z.object({
  result: z.object({
    post: stateParser,
    pre: stateParser,
  }),
});

const facetCutSchema = z.object({
  facet: hexSchema,
  action: z.number(),
  isFreezable: z.boolean(),
  selectors: z.array(hexSchema),
});

export const callDataSchema = z.object({
  functionName: z.string(),
  args: z.tuple([
    z.object({
      facetCuts: z.array(facetCutSchema),
      initAddress: hexSchema,
      initCalldata: hexSchema,
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
        data: hexSchema,
      }),
      factoryDeps: z.array(z.any()),
      bootloaderHash: hexSchema,
      defaultAccountHash: hexSchema,
      verifier: hexSchema,
      verifierParams: z.any(),
      l1ContractsUpgradeCalldata: z.string(),
      postUpgradeCalldata: hexSchema,
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
        bytecodeHash: hexSchema,
        newAddress: hexSchema,
        callConstructor: z.boolean(),
        value: z.bigint(),
        input: z.string(),
      })
    ),
  ]),
});

export const contractEventSchema = z.object({
  address: hexSchema,
  topics: z.array(hexSchema),
  data: hexSchema,
  transactionHash: hexSchema,
  blockNumber: hexSchema,
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
