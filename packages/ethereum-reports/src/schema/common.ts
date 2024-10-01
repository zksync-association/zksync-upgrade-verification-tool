import { z } from "zod";

export const numericString = z.string().regex(/^[0-9]+$/, "Invalid number");
