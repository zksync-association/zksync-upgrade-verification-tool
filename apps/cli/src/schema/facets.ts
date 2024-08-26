import { z } from "zod";
import { bytes32Hash } from "./common";
import { zodHex } from "./hex-parser";

export const facetsSchema = z.record(
  z.string(),
  z.object({
    address: zodHex,
    txHash: bytes32Hash,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
