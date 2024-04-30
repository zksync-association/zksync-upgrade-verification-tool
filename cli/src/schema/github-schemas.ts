import z from "zod";

export const systemContractHashesSchema = z.array(
  z.object({
    contractName: z.string(),
    bytecodePath: z.string(),
    sourceCodePath: z.string(),
    bytecodeHash: z.string(),
    sourceCodeHash: z.string(),
  })
);

export const githubContentParser = z.object({
  data: z.object({
    content: z.string(),
  }),
});
