import { type Address, type Hex, hexToBigInt } from "viem";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { addressSchema, hexSchema } from "@repo/common/schemas";
import { Option } from "nochoices";

const schema = z.object({
  calls: z.array(
    z.object({
      value: hexSchema.transform((hex) => hexToBigInt(hex)),
      data: hexSchema,
      target: addressSchema,
    })
  ),
  executor: addressSchema,
  salt: hexSchema,
});

export type RawCall = {
  value: bigint;
  data: Hex;
  target: Address;
};

export class UpgradeFile {
  calls: RawCall[];
  executor: Hex;
  salt: Hex;

  constructor(calls: RawCall[], executor: Hex, salt: Hex) {
    this.calls = calls;
    this.executor = executor;
    this.salt = salt;
  }

  firstCallData(): Option<Hex> {
    return Option.fromNullable(this.calls[0]).map((call) => call.data);
  }

  static fromFile(path: string) {
    const buff = readFileSync(path);
    const obj = JSON.parse(buff.toString());
    const parsed = schema.parse(obj);
    return new UpgradeFile(parsed.calls, parsed.executor, parsed.salt);
  }
}
