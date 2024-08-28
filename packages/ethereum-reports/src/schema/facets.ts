import { z } from "zod";
import { addressSchema, bytes32Schema } from "@repo/common/schemas";

export const facetsSchema = z.record(
  z.string(),
  z.object({
    address: addressSchema,
    txHash: bytes32Schema,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
