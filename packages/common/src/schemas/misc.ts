import { Option } from "nochoices";
import { type ZodTypeAny, type ZodEffects, type ZodOptional, z } from "zod";

export const optionSchema = <T extends ZodTypeAny>(
  t: T
): ZodEffects<ZodOptional<T>, Option<z.infer<T>>> => {
  return z.optional(t).transform<Option<z.infer<T>>>((val) => Option.fromNullable(val));
};
