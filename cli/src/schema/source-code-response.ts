import { z } from "zod";

const etherscanSourceCodeSchema = z.object({
  SourceCode: z.string(),
  ContractName: z.string(),
  CompilerVersion: z.string(),
  OptimizationUsed: z.string(),
  Runs: z.string(),
  ConstructorArguments: z.string(),
  EVMVersion: z.string(),
  Library: z.string(),
  LicenseType: z.string(),
  Proxy: z.string(),
  Implementation: z.string(),
  SwarmSource: z.string(),
});
export const sourceCodeResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  result: z.array(etherscanSourceCodeSchema),
});

export const sourceCodeSchema = z.object({
  language: z.string(),
  sources: z.record(z.string(), z.object({ content: z.string() })),
});

export type RawSourceCode = z.infer<typeof sourceCodeSchema>;
