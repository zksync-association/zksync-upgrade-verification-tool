import { z } from "zod";

export const UserRoleSchema = z.enum(["guardian", "securityCouncil", "zkFoundation", "visitor"]);
export type UserRole = z.infer<typeof UserRoleSchema>;