import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{
  data: string;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
  toDriver(val) {
    let newVal = val;
    if (val.startsWith("0x")) {
      newVal = val.slice(2);
    }
    return Buffer.from(newVal, "hex");
  },
  fromDriver(val) {
    return val.toString("hex");
  },
});
