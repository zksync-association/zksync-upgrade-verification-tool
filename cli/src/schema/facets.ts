import { z } from "zod";
import { account20String, bytes32Hash } from "../schema";

export const facetsSchema = z.record(
  z.string(),
  z.object({
    address: account20String,
    txHash: bytes32Hash,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
