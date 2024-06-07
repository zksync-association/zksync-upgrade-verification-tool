import { z } from "zod";

export const zodHex = z.custom<`0x${string}`>((val: any) => {
  if (typeof val !== "string") {
    return false;
  }
  if (!val.startsWith("0x")) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(val.substring(2));
});


