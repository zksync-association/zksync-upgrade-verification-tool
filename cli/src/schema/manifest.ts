import { z } from "zod";

// TODO: Map out all the schemas for the type of json files being produced

export const numberString = z.string().refine((value) => /^\d+$/.test(value), {
  message: "String must contain only numbers.",
});

export const commonJsonSchema = z.object({
  name: z.string(),
  creationTimestamp: z.number(),
  protocolVersion: numberString,
});
