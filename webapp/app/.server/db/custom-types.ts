import { customType } from "drizzle-orm/pg-core";
import type { Hex } from "viem";
import { z } from "zod";

const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);
export type HexString = z.infer<typeof hexSchema>;
export const AddressSchema = hexSchema.length(42);
export type AddressHex = z.infer<typeof AddressSchema>;

export const bytea = customType<{
  data: Hex;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(val) {
    const parsed = hexSchema.parse(val);

    // Avoid Buffer.from("0"). It returns an empty buffer, which gets later interpreted as empty hex.
    if (parsed === "0x0") {
      return Buffer.from([0]);
    }
    if (parsed.startsWith("0x")) {
      return Buffer.from(parsed.slice(2), "hex");
    }
    return Buffer.from(parsed, "hex");
  },
  fromDriver(val) {
    const hex = `0x${val.toString("hex")}`;
    return hexSchema.parse(hex) as Hex;
  },
});
