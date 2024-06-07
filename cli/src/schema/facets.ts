import { z } from "zod";
import { account20String, bytes32Hash } from "../schema";
import {zodHex} from "./hex-parser";

export const facetsSchema = z.record(
  z.string(),
  z.object({
    address: zodHex,
    txHash: bytes32Hash,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
