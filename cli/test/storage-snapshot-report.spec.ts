import { describe, it, expect } from "vitest";
import { SnapshotReport } from "../src/lib/reports/storage-snapshot-report";
import { RecordStorageSnapshot } from "../src/lib/storage/record-storage-snapshot";
import { BigNumberType } from "../src/lib/storage/types/big-number-type";
import { Property } from "../src/lib/storage/property";
import { BlobType } from "../src/lib/storage/types/blob-type";
import { AddressType } from "../src/lib/storage/types/address-type";
import { bytesToHex, hexToBigInt, hexToBytes, keccak256, numberToBytes, numberToHex } from "viem";
import { ArrayType } from "../src/lib/storage/types/array-type";
import { StructType } from "../src/lib/storage/types/struct-type";
import { MappingType } from "../src/lib/storage/mapping-type";

describe("SnapshotReport", () => {
  it("can return a number prop ", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    const props = [new Property("prop1", 0n, "desc1", new BigNumberType())];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value: 1
----------`);
  });

  it("can return a hex prop ", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    const props = [new Property("prop1", 0n, "desc1", new BlobType())];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value: 0x0000000000000000000000000000000000000000000000000000000000000001
----------`);
  });

  it("can return a hex prop ", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    const props = [new Property("prop1", 0n, "desc1", new BlobType())];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value: 0x0000000000000000000000000000000000000000000000000000000000000001
----------`);
  });

  it("can return an address prop ", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    const props = [new Property("prop1", 0n, "desc1", new AddressType())];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value: 0x0000000000000000000000000000000000000001
----------`);
  });

  it("can return a list prop ", async () => {
    const hashed = hexToBigInt(
      keccak256("0x000000000000000000000000000000000000000000000000000000000000000")
    );
    const data = new RecordStorageSnapshot({
      "0x000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000003",

      [numberToHex(hashed + 0n)]:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      [numberToHex(hashed + 1n)]:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      [numberToHex(hashed + 2n)]:
        "0x0000000000000000000000000000000000000000000000000000000000000003",
    });
    const props = [new Property("prop1", 0n, "desc1", new ArrayType(new BlobType()))];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value:
  - 0x0000000000000000000000000000000000000000000000000000000000000001
  - 0x0000000000000000000000000000000000000000000000000000000000000002
  - 0x0000000000000000000000000000000000000000000000000000000000000003
----------`);
  });

  it("can return a struct prop with only one attribute", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x000000000000000000000000000000000000000000000000000000000000000a",
      "0x0000000000000000000000000000000000000000000000000000000000000001":
        "0x000000000000000000000000000000000000000000000000000000000000000b",
      "0x0000000000000000000000000000000000000000000000000000000000000002":
        "0x000000000000000000000000000000000000000000000000000000000000000c",
    });
    const props = [
      new Property(
        "prop1",
        0n,
        "desc1",
        new StructType([
          {
            name: "prop1",
            type: new BigNumberType(),
          },
        ])
      ),
    ];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value:
  .prop1: 10
----------`);
  });

  it("can return a struct prop ", async () => {
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x000000000000000000000000000000000000000000000000000000000000000a",
      "0x0000000000000000000000000000000000000000000000000000000000000001":
        "0x000000000000000000000000000000000000000000000000000000000000000b",
      "0x0000000000000000000000000000000000000000000000000000000000000002":
        "0x000000000000000000000000000000000000000000000000000000000000000c",
    });
    const props = [
      new Property(
        "prop1",
        0n,
        "desc1",
        new StructType([
          {
            name: "prop1",
            type: new BigNumberType(),
          },
          {
            name: "prop2",
            type: new BigNumberType(),
          },
          {
            name: "prop3",
            type: new BigNumberType(),
          },
        ])
      ),
    ];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value:
  .prop1: 10
  .prop2: 11
  .prop3: 12
----------`);
  });

  it("can return a struct mapping", async () => {
    let key = hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000001");
    const hashed = keccak256(
      Buffer.concat([
        key,
        hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000000"),
      ])
    );
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      [hashed]: "0x000000000000000000000000000000000000000000000000000000000000000a",
    });
    const props = [
      new Property(
        "prop1",
        0n,
        "desc1",
        new MappingType([Buffer.from(key)], new BigNumberType(), true)
      ),
    ];
    const report = new SnapshotReport(data, props);
    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value:
  [${bytesToHex(key)}]: 10
----------`);
  });

  it("formats correctly a map of structs with a list", async () => {
    let key = hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000001");
    const hashedMapping = keccak256(
      Buffer.concat([
        key,
        hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000000"),
      ])
    );
    const hashedList = keccak256(hashedMapping);
    const data = new RecordStorageSnapshot({
      "0x0000000000000000000000000000000000000000000000000000000000000000":
        "0x000000000000000000000000000000000000000000000000000000000000000a",
      [hashedMapping]: "0x0000000000000000000000000000000000000000000000000000000000000001",
      [hashedList]: "0x000000000000000000000000000000000000000000000000000000000e18b681",
    });

    const props = [
      new Property(
        "prop1",
        0n,
        "desc1",
        new MappingType(
          [Buffer.from(key)],
          new StructType([
            {
              name: "selectors",
              type: new ArrayType(new BlobType(4)),
            },
          ]),
          true
        )
      ),
    ];
    const report = new SnapshotReport(data, props);

    expect(await report.format()).toEqual(`----------
name: prop1
description: desc1

value:
  [${bytesToHex(key)}]:
    .selectors: 
      - 0x0e18b681
----------`);
  });
});
