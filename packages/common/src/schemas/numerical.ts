import { z } from "zod";

export const nonZeroBigIntStrSchema = z.coerce
  .bigint({ message: "Must be a integer number" })
  .refine((num) => num !== 0n, { message: "Cannot be zero" })
  .transform((num) => num.toString());
