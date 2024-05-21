import z from "zod";

export const systemContractHashesParser = z.array(
  z.object({
    contractName: z.string(),
    bytecodePath: z.string(),
    sourceCodePath: z.string(),
    bytecodeHash: z.string(),
    sourceCodeHash: z.string(),
  })
);

export type SystemContractHashes = z.infer<typeof systemContractHashesParser>