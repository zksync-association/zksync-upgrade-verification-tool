import { z } from "zod";
import { numericString } from "./common";

export const getAbiSchema = z.object({
  status: numericString,
  message: z.enum(["OK", "NOTOK"]),
  result: z.string(),
});

export const etherscanSourceCodeSchema = z.object({
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
  status: numericString,
  message: z.enum(["OK", "NOTOK"]),
  result: z.array(etherscanSourceCodeSchema),
});

const sourcesParser = z.record(z.string(), z.object({ content: z.string() }));
export const sourceCodeSchema = z.object({
  language: z.string(),
  sources: sourcesParser,
});

export type RawSourceCode = z.infer<typeof sourceCodeSchema>;
export type Sources = z.infer<typeof sourcesParser>;
