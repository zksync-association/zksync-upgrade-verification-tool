import { customType } from "drizzle-orm/pg-core";
import { Hex } from "viem";

export const bytea = customType<{
  data: Hex;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(val) {

    if (val.startsWith("0x")) {

      return Buffer.from(val.slice(2), "hex")
    } else {
      return Buffer.from(val, "hex")
    }
  },
  fromDriver(val): Hex {
    return `0x${val.toString("hex")}`;
  },
});
