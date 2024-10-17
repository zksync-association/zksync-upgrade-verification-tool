import { z } from "zod";
import { hexSchema } from "./hex";

export const callSchema = z.object({
  target: hexSchema,
  data: hexSchema,
  value: hexSchema,
});

export type Call = z.infer<typeof callSchema>;