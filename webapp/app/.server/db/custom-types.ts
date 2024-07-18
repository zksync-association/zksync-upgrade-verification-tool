import { customType } from "drizzle-orm/pg-core";
import { z } from "zod";

const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);
export type HexSchema = z.infer<typeof hexSchema>;

export const bytea = customType<{
  data: HexSchema;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(val) {
    const parsed = hexSchema.parse(val);
    if (parsed.startsWith("0x")) {
      return Buffer.from(parsed.slice(2), "hex");
    }
    return Buffer.from(parsed, "hex");
  },
  fromDriver(val): HexSchema {
    const hex = `0x${val.toString("hex")}`;
    return hexSchema.parse(hex) as `0x${string}`;
  },
});
