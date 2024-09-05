import { z } from "zod";

export const UserRoleEnum = z.enum(["guardian", "securityCouncil", "zkFoundation", "visitor"]);
export type UserRole = z.infer<typeof UserRoleEnum>;
