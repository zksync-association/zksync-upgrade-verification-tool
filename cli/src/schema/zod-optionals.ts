import { z, type ZodEffects, type ZodOptional, type ZodTypeAny } from "zod";
import { Option } from "nochoices";
import type { Hex } from "viem";

export const zodOptional = <T extends ZodTypeAny>(
  t: T
): ZodEffects<ZodOptional<T>, Option<z.infer<T>>> => {
  return z.optional(t).transform<Option<z.infer<T>>>((val) => Option.fromNullable(val));
};

export const zodHex = z
  .string()
  .transform(v => v === "0x" ? "0x0" : v)
  .refine((str) => /0x[0-9a-fA-F]+/.test(str), "Not a valid hex")
  .transform((str) => str as Hex);
