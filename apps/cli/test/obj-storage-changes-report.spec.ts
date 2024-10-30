import { describe, expect, it } from "vitest";
import { type Hex, hexToBigInt, keccak256, numberToBytes, numberToHex } from "viem";
import { RecordStorageSnapshot } from "../src/reports/storage/snapshot";
import { ContractField } from "../src/reports/storage/contractField";
import { AddressType } from "../src/reports/storage/types/address-type";
import { StorageChanges } from "../src/reports/storage/storage-changes";
import { ObjectStorageChangeReport } from "../src/reports/reports/object-storage-change-report";
import { BigNumberType } from "../src/reports/storage/types/big-number-type";
import { BlobType } from "../src/reports/storage/types/blob-type";
import { BooleanType } from "../src/reports/storage/types/boolean-type";
import { ArrayType } from "../src/reports/storage/types/array-type";
import { FixedArrayType } from "../src/reports/storage/types/fixed-array-type";
import { StructType } from "../src/reports/storage/types/struct-type";

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

    it("can display address elements", async () => {
      const prop = new ContractField(
        "someProp",
        BigInt(0xa),
        "some description",
        new AddressType()
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);
      const report = new ObjectStorageChangeReport(memoryMap);
      expect(await report.format()).toEqual([
        {
          name: "someProp",
          description: "some description",
          currentValue: {
            type: "address",
            value: "0x000000000000000000000000000000000000000a",
          },
          proposedValue: {
            type: "address",
            value: "0x0000000000000000000000000000000000000014",
          },
        },
      ]);
    });

    it("can display types elements", async () => {
      const prop = new ContractField(
        "numberProp",
        BigInt(0xa),
        "it is a number",
        new BigNumberType()
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);
      expect(await report.format()).toEqual([
        {
          name: "numberProp",
          description: "it is a number",
          currentValue: {
            type: "numeric",
            value: "10",
          },
          proposedValue: {
            type: "numeric",
            value: "20",
          },
        },
      ]);
    });

    it("can display blob elements", async () => {
      const prop = new ContractField("blobProp", BigInt(0xa), "it is a blob", new BlobType());
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);
      expect(await report.format()).toEqual([
        {
          name: "blobProp",
          description: "it is a blob",
          currentValue: {
            type: "blob",
            value: "0x000000000000000000000000000000000000000000000000000000000000000a",
          },
          proposedValue: {
            type: "blob",
            value: "0x0000000000000000000000000000000000000000000000000000000000000014",
          },
        },
      ]);
    });

    it("can display boolean elements", async () => {
      const prop = new ContractField("booleanProp", boolSlot, "true or false", new BooleanType());
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);
      expect(await report.format()).toEqual([
        {
          name: "booleanProp",
          description: "true or false",
          currentValue: {
            type: "boolean",
            value: true,
          },
          proposedValue: {
            type: "boolean",
            value: false,
          },
        },
      ]);
    });

    it("can display list elements", async () => {
      const prop = new ContractField(
        "listProp",
        listSlot,
        "it is a list",
        new ArrayType(new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);
      expect(await report.format()).toEqual([
        {
          name: "listProp",
          description: "it is a list",
          currentValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "100",
              },
              {
                type: "numeric",
                value: "101",
              },
              {
                type: "numeric",
                value: "102",
              },
            ],
          },
          proposedValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "100",
              },
              {
                type: "numeric",
                value: "201",
              },
              {
                type: "numeric",
                value: "102",
              },
              {
                type: "numeric",
                value: "103",
              },
            ],
          },
        },
      ]);
    });

    it("can display fixed array elements", async () => {
      const prop = new ContractField(
        "listProp",
        hexToBigInt(hashedListSlot),
        "it is a list",
        new FixedArrayType(3, new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);

      expect(await report.format()).toEqual([
        {
          name: "listProp",
          description: "it is a list",
          currentValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "100",
              },
              {
                type: "numeric",
                value: "101",
              },
              {
                type: "numeric",
                value: "102",
              },
            ],
          },
          proposedValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "100",
              },
              {
                type: "numeric",
                value: "201",
              },
              {
                type: "numeric",
                value: "102",
              },
            ],
          },
        },
      ]);
    });

    it("can display fixed array elements when some are not present", async () => {
      const prop = new ContractField(
        "listProp",
        hexToBigInt(hashedListSlot) + 1n,
        "it is a list",
        new FixedArrayType(3, new BigNumberType())
      );
      const memoryMap = new StorageChanges(pre, post, [], [], [prop]);

      const report = new ObjectStorageChangeReport(memoryMap);

      expect(await report.format()).toEqual([
        {
          name: "listProp",
          description: "it is a list",
          currentValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "101",
              },
              {
                type: "numeric",
                value: "102",
              },
              {
                type: "empty",
              },
            ],
          },
          proposedValue: {
            type: "array",
            value: [
              {
                type: "numeric",
                value: "201",
              },
              {
                type: "numeric",
                value: "102",
              },
              {
                type: "numeric",
                value: "103",
              },
            ],
          },
        },
      ]);
    });

    it("can display struct elements", async () => {
      const prop = new ContractField(
        "structProp",
        hexToBigInt(hashedListSlot),
        "so many fields",
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

      const report = new ObjectStorageChangeReport(memoryMap);

      expect(await report.format()).toEqual([
        {
          name: "structProp",
          description: "so many fields",
          currentValue: {
            type: "struct",
            fields: [
              {
                key: "field1",
                value: {
                  type: "numeric",
                  value: "100",
                },
              },
              {
                key: "field2",
                value: {
                  type: "address",
                  value: "0x0000000000000000000000000000000000000065",
                },
              },
              {
                key: "field3",
                value: {
                  type: "blob",
                  value: "0x0000000000000000000000000000000000000000000000000000000000000066",
                },
              },
              {
                key: "field4",
                value: { type: "empty" },
              },
            ],
          },
          proposedValue: {
            type: "struct",
            fields: [
              {
                key: "field1",
                value: {
                  type: "numeric",
                  value: "100",
                },
              },
              {
                key: "field2",
                value: {
                  type: "address",
                  value: "0x00000000000000000000000000000000000000c9",
                },
              },
              {
                key: "field3",
                value: {
                  type: "blob",
                  value: "0x0000000000000000000000000000000000000000000000000000000000000066",
                },
              },
              {
                key: "field4",
                value: { type: "numeric", value: "103" },
              },
            ],
          },
        },
      ]);
    });
  });
});
