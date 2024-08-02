import { z } from "zod";

export const UserRole = z.enum(["guardian", "securityCouncil", "zkFoundation", "visitor"]);