import { z } from "zod";
import { numberString } from "./common";

export const commonJsonSchema = z.object({
  name: z.string(),
  creationTimestamp: z.number(),
  protocolVersion: numberString,
});

export type UpgradeManifest = z.infer<typeof commonJsonSchema>;
