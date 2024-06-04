import type { MemoryDataType } from "./data-type";
import type { MemorySnapshot } from "../memory-snapshot";
import { Option } from "nochoices";
import { BlobType } from "./blob-type";

export class VerifierParamsType implements MemoryDataType {
  extract(memory: MemorySnapshot, slot: bigint): Option<string> {
    const hex = new BlobType();
    const keys = [
      "recursionNodeLevelVkHash",
      "recursionLeafLevelVkHash",
      "recursionCircuitsSetVksHash",
    ];

    const arr = keys.map<[string, Option<string>]>((name, i) => {
      const index = slot + BigInt(i);
      return [name, hex.extract(memory, index)];
    });

    if (!arr.some(([_name, opt]) => opt.isSome())) {
      return Option.None();
    }

    return Option.Some(
      arr.map(([name, opt]) => `.${name}: ${opt.unwrapOr("Not affected")}`).join("\n")
    );
  }

  get evmSize(): number {
    return 32 * 3;
  }
}
