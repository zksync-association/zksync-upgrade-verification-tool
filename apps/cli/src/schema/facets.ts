import { z } from "zod";
import { bytes32Hash } from "./common.js";
import { zodHex } from "./hex-parser.js";

export const facetsSchema = z.record(
  z.string(),
  z.object({
    address: zodHex,
    txHash: bytes32Hash,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
