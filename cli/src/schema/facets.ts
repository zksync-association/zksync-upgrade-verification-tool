import { z } from "zod";
import { account20String, bytes32Hash } from "../schema";

// const facetNames = z.enum(["ExecutorFacet", "AdminFacet", "GettersFacet", "MailboxFacet"]);
const facetNames = z.string();
export const facetsSchema = z.record(
  facetNames,
  z.object({
    address: account20String,
    txHash: bytes32Hash,
  })
);

export type FacetsJson = z.infer<typeof facetsSchema>;
