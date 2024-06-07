import {z, ZodEffects, ZodOptional, type ZodTypeAny} from "zod";
import {Option} from "nochoices";

export const zodOptional = <T extends ZodTypeAny> (t: T): ZodEffects<ZodOptional<T>, Option<z.infer<T>>> => {
  return z.optional(t).transform<Option<z.infer<T>>>(val => Option.fromNullable(val))
}