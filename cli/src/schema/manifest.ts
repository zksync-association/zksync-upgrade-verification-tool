import { z } from "zod";
import { numericString } from "./common";

export const commonJsonSchema = z.object({
  name: z.string(),
  creationTimestamp: z.number(),
  protocolVersion: numericString,
});

export type UpgradeManifest = z.infer<typeof commonJsonSchema>;
