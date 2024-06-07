import {z, type ZodType} from "zod";
import {Option} from "nochoices";

const option = <T extends ZodType>(t: T) => z.optional(t).transform<Option<T>>(obj => Option.fromNullable(obj) )

const stateParser = z.record(
  z.string(),
  z.object({
    nonce: z.optional(z.number()),
    storage: z.optional(z.record(z.string(), z.string())),
  })
);

export const memoryDiffParser = z.object({
  result: z.object({
    post: stateParser,
    pre: stateParser,
  }),
});

export type MemoryDiffRaw = z.infer<typeof memoryDiffParser>;
