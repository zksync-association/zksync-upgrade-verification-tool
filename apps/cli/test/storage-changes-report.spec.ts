import { describe, expect, it } from "vitest";
import { type Hex, hexToBigInt, keccak256, numberToBytes, numberToHex } from "viem";
import chalk from "chalk";
import { StringStorageChangeReport } from "@repo/ethereum-reports/reports/string-storage-change-report";
import { ContractField } from "@repo/ethereum-reports/storage/contractField";
import { RecordStorageSnapshot } from "@repo/ethereum-reports/storage/snapshot/record-storage-snapshot";
import { StorageChanges } from "@repo/ethereum-reports/storage/storage-changes";
import { AddressType } from "@repo/ethereum-reports/storage/types/address-type";
import { ArrayType } from "@repo/ethereum-reports/storage/types/array-type";
import { BigNumberType } from "@repo/ethereum-reports/storage/types/big-number-type";
import { BlobType } from "@repo/ethereum-reports/storage/types/blob-type";
import { BooleanType } from "@repo/ethereum-reports/storage/types/boolean-type";
import { FixedArrayType } from "@repo/ethereum-reports/storage/types/fixed-array-type";
import { StructType } from "@repo/ethereum-reports/storage/types/struct-type";

describe("MemoryMapReport", () => {
  describe("For simple memory diff", () => {
    const boolSlot = BigInt(0xf);
    const listSlot = BigInt(0x10);
    const hashedListSlot = keccak256(numberToBytes(listSlot, { size: 32 }));

    function addToHashed(hash: Hex, add: bigint): Hex {
      const n = hexToBigInt(hash);
      return numberToHex(n + add, { size: 32 });
    }

    const pre = new RecordStorageSnapshot({
      "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(10, {
        size: 32,
      }),
      [numberToHex(boolSlot, { size: 32 })]: numberToHex(1, { size: 32 }),
      [numberToHex(listSlot, { size: 32 })]: numberToHex(3, { size: 32 }),
      [addToHashed(hashedListSlot, 0n)]: numberToHex(100, { size: 32 }),
      [addToHashed(hashedListSlot, 1n)]: numberToHex(101, { size: 32 }),
      [addToHashed(hashedListSlot, 2n)]: numberToHex(102, { size: 32 }),
    });

    const post = new RecordStorageSnapshot({
      "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(20, {
        size: 32,
      }),
      [numberToHex(boolSlot, { size: 32 })]: numberToHex(0, { size: 32 }),
      [numberToHex(listSlot, { size: 32 })]: numberToHex(4, { size: 32 }),
      [addToHashed(hashedListSlot, 0n)]: numberToHex(100, { size: 32 }),
      [addToHashed(hashedListSlot, 1n)]: numberToHex(201, { size: 32 }),
      [addToHashed(hashedListSlot, 2n)]: numberToHex(102, { size: 32 }),
      [addToHashed(hashedListSlot, 3n)]: numberToHex(103, { size: 32 }),
    });

    function expectedReportSingleLine(
      name: string,
      description: string,
      before: string,
      after: string
    ): string {
      return (
        // biome-ignore lint/style/useTemplate: <explanation>
        "--------------------------\n" +
        `name: ${chalk.bold(name)}\n` +
        `description: ${description}\n\n` +
        `before: ${before}\n\n` +
        `after: ${after}\n` +
        "--------------------------"
      );
    }

    function expectedReportMultiLine(
      name: string,
      description: string,
      before: string,
      after: string
    ): string {
      return (
        // biome-ignore lint/style/useTemplate: <explanation>
        "--------------------------\n" +
        `name: ${chalk.bold(name)}\n` +
        `description: ${description}\n\n` +
        `before:\n  ${before}\n\n` +
        `after:\n  ${after}\n` +
        "--------------------------"
      );
    }

    it("can display address elements", async () => {
      const prop = new ContractField(
        "someProp",
        BigInt(0xa),
        "some description",
        new AddressType()
      );

      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      expect(await report.format()).toEqual(
        expectedReportSingleLine(
          "someProp",
          "some description",
          numberToHex(10, { size: 20 }),
          numberToHex(20, { size: 20 })
        )
      );
    });

    it("can display types elements", async () => {
      const prop = new ContractField(
        "numberProp",
        BigInt(0xa),
        "it is a number",
        new BigNumberType()
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      expect(await report.format()).toEqual(
        expectedReportSingleLine("numberProp", "it is a number", "10", "20")
      );
    });

    it("can display blob elements", async () => {
      const prop = new ContractField("blobProp", BigInt(0xa), "it is a blob", new BlobType());
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      expect(await report.format()).toEqual(
        expectedReportSingleLine(
          "blobProp",
          "it is a blob",
          numberToHex(10, { size: 32 }),
          numberToHex(20, { size: 32 })
        )
      );
    });

    it("can display boolean elements", async () => {
      const prop = new ContractField("blobProp", boolSlot, "it is a blob", new BooleanType());
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      expect(await report.format()).toEqual(
        expectedReportSingleLine("blobProp", "it is a blob", "true", "false")
      );
    });

    it("can display list elements", async () => {
      const prop = new ContractField(
        "listProp",
        listSlot,
        "it is a list",
        new ArrayType(new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      const before = ["- 100", "- 101", "- 102"].join("\n  ");
      const after = ["- 100", "- 201", "- 102", "- 103"].join("\n  ");

      expect(await report.format()).toEqual(
        expectedReportMultiLine("listProp", "it is a list", before, after)
      );
    });

    it("can display fixed array elements", async () => {
      const prop = new ContractField(
        "listProp",
        hexToBigInt(hashedListSlot),
        "it is a list",
        new FixedArrayType(3, new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      const before = ["- 100", "- 101", "- 102"].join("\n  ");
      const after = ["- 100", "- 201", "- 102"].join("\n  ");

      expect(await report.format()).toEqual(
        expectedReportMultiLine("listProp", "it is a list", before, after)
      );
    });

    it("can display fixed array elements when some are not present", async () => {
      const prop = new ContractField(
        "listProp",
        hexToBigInt(hashedListSlot) + 1n,
        "it is a list",
        new FixedArrayType(3, new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

      const before = ["- 101", "- 102", "- Empty slot."].join("\n  ");
      const after = ["- 201", "- 102", "- 103"].join("\n  ");

      expect(await report.format()).toEqual(
        expectedReportMultiLine("listProp", "it is a list", before, after)
      );
    });

    it("can display struct elements", async () => {
      const prop = new ContractField(
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
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new StringStorageChangeReport(memoryMap, true);

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

      expect(await report.format()).toEqual(
        expectedReportMultiLine("listProp", "it is a list", before, after)
      );
    });
  });
});
