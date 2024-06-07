import { describe, expect, it } from "vitest";
import { MemoryMap } from "../src/lib/memory-map/memory-map";
import type { MemoryDiffRaw } from "../src/schema/rpc";
import { type Hex, hexToBigInt, keccak256, numberToBytes, numberToHex } from "viem";
import chalk from "chalk";
import { AddressType } from "../src/lib/memory-map/types/address-type";
import { Property } from "../src/lib/memory-map/property";
import { BigNumberType } from "../src/lib/memory-map/types/big-number-type";
import { StringMemoryReport } from "../src/lib/reports/memory-report";
import { BlobType } from "../src/lib/memory-map/types/blob-type";
import { BooleanType } from "../src/lib/memory-map/types/boolean-type";
import { ArrayType } from "../src/lib/memory-map/types/array-type";
import { FixedArrayType } from "../src/lib/memory-map/types/fixed-array-type";
import { StructType } from "../src/lib/memory-map/types/struct-type";

describe("MemoryMapReport", () => {
  describe("For simple memory diff", () => {
    const boolSlot = BigInt(0xf);
    const listSlot = BigInt(0x10);
    const hashedListSlot = keccak256(numberToBytes(listSlot, { size: 32 }));

    function addToHashed(hash: Hex, add: bigint): Hex {
      const n = hexToBigInt(hash);
      return numberToHex(n + add, { size: 32 });
    }

    const diff: MemoryDiffRaw = {
      result: {
        pre: {
          addr: {
            storage: {
              "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(
                10,
                { size: 32 }
              ),
              [numberToHex(boolSlot, { size: 32 })]: numberToHex(1, { size: 32 }),
              [numberToHex(listSlot, { size: 32 })]: numberToHex(3, { size: 32 }),
              [addToHashed(hashedListSlot, 0n)]: numberToHex(100, { size: 32 }),
              [addToHashed(hashedListSlot, 1n)]: numberToHex(101, { size: 32 }),
              [addToHashed(hashedListSlot, 2n)]: numberToHex(102, { size: 32 }),
            },
          },
        },
        post: {
          addr: {
            storage: {
              "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(
                20,
                { size: 32 }
              ),
              [numberToHex(boolSlot, { size: 32 })]: numberToHex(0, { size: 32 }),
              [numberToHex(listSlot, { size: 32 })]: numberToHex(4, { size: 32 }),
              [addToHashed(hashedListSlot, 0n)]: numberToHex(100, { size: 32 }),
              [addToHashed(hashedListSlot, 1n)]: numberToHex(201, { size: 32 }),
              [addToHashed(hashedListSlot, 2n)]: numberToHex(102, { size: 32 }),
              [addToHashed(hashedListSlot, 3n)]: numberToHex(103, { size: 32 }),
            },
          },
        },
      },
    };

    function expectedReport(
      name: string,
      description: string,
      before: string,
      after: string
    ): string {
      return (
        "--------------------------\n" +
        `name: ${chalk.bold(name)}\n` +
        `description: ${description}\n\n` +
        `before:\n` +
        `  ${before}\n\n` +
        `after:\n` +
        `  ${after}\n` +
        "--------------------------"
      );
    }

    it("can display address elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [new Property("someProp", BigInt(0xa), "some description", new AddressType())]
      );

      const change = memoryMap.changeFor("someProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      expect(report.format()).toEqual(
        expectedReport(
          "someProp",
          "some description",
          numberToHex(10, { size: 20 }),
          numberToHex(20, { size: 20 })
        )
      );
    });

    it("can display types elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [new Property("numberProp", BigInt(0xa), "it is a number", new BigNumberType())]
      );

      const change = memoryMap.changeFor("numberProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      expect(report.format()).toEqual(expectedReport("numberProp", "it is a number", "10", "20"));
    });

    it("can display blob elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [new Property("blobProp", BigInt(0xa), "it is a blob", new BlobType())]
      );

      const change = memoryMap.changeFor("blobProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      expect(report.format()).toEqual(
        expectedReport(
          "blobProp",
          "it is a blob",
          numberToHex(10, { size: 32 }),
          numberToHex(20, { size: 32 })
        )
      );
    });

    it("can display boolean elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [new Property("blobProp", boolSlot, "it is a blob", new BooleanType())]
      );

      const change = memoryMap.changeFor("blobProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      expect(report.format()).toEqual(expectedReport("blobProp", "it is a blob", "true", "false"));
    });

    it("can display list elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [new Property("listProp", listSlot, "it is a list", new ArrayType(new BigNumberType()))]
      );

      const change = memoryMap.changeFor("listProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      const before = ["- 100", "- 101", "- 102"].join("\n  ");
      const after = ["- 100", "- 201", "- 102", "- 103"].join("\n  ");

      expect(report.format()).toEqual(expectedReport("listProp", "it is a list", before, after));
    });

    it("can display fixed array elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [
          new Property(
            "listProp",
            hexToBigInt(hashedListSlot),
            "it is a list",
            new FixedArrayType(3, new BigNumberType())
          ),
        ]
      );

      const change = memoryMap.changeFor("listProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      const before = ["- 100", "- 101", "- 102"].join("\n  ");
      const after = ["- 100", "- 201", "- 102"].join("\n  ");

      expect(report.format()).toEqual(expectedReport("listProp", "it is a list", before, after));
    });

    it("can display fixed array elements when some are not present", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [
          new Property(
            "listProp",
            hexToBigInt(hashedListSlot) + 1n,
            "it is a list",
            new FixedArrayType(3, new BigNumberType())
          ),
        ]
      );

      const change = memoryMap.changeFor("listProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      const before = ["- 101", "- 102", "- Empty slot."].join("\n  ");
      const after = ["- 201", "- 102", "- 103"].join("\n  ");

      expect(report.format()).toEqual(expectedReport("listProp", "it is a list", before, after));
    });

    it("can display struct elements", () => {
      const memoryMap = new MemoryMap(
        diff,
        "addr",
        [],
        [],
        [
          new Property(
            "listProp",
            hexToBigInt(hashedListSlot),
            "it is a list",
            new StructType([
              {
                name: "field1",
                type: new BigNumberType(),
              },
              {
                name: "field2",
                type: new AddressType(),
              },
              {
                name: "field3",
                type: new BlobType(),
              },
              {
                name: "field4",
                type: new BigNumberType(),
              },
            ])
          ),
        ]
      );

      const change = memoryMap.changeFor("listProp").unwrap();
      const report = new StringMemoryReport();
      report.add(change);

      const before = [
        ".field1: 100",
        ".field2: 0x0000000000000000000000000000000000000065",
        ".field3: 0x0000000000000000000000000000000000000000000000000000000000000066",
        ".field4: Empty slot.",
      ].join("\n  ");
      const after = [
        ".field1: 100",
        ".field2: 0x00000000000000000000000000000000000000c9",
        ".field3: 0x0000000000000000000000000000000000000000000000000000000000000066",
        ".field4: 103",
      ].join("\n  ");

      expect(report.format()).toEqual(expectedReport("listProp", "it is a list", before, after));
    });
  });
});
