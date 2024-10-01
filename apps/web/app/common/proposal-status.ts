import { z } from "zod";

export const proposalStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
