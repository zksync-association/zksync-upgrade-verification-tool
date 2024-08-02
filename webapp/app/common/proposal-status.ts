import { z } from "zod";

export const emergencyProposalStatusSchema = z.enum(["ACTIVE", "READY", "BROADCAST", "CLOSED"]);
export type EmergencyProposalStatus = z.infer<typeof emergencyProposalStatusSchema>;