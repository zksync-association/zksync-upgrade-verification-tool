import { z } from "zod";
import { numberString } from "./common";

export const getAbiSchema = z.object({
  status: numberString,
  message: z.enum(["OK", "NOTOK"]),
  result: z.string(),
});

