import { describe, expect, it } from "vitest";
import { StorageChanges } from "../src/lib/storage/storage-changes";
import fs from "node:fs/promises";
import path from "node:path";
import { memoryDiffParser } from "../src/index";
import {
  bytesToHex,
  encodeAbiParameters,
  hashTypedData,
  type Hex,
  hexToBigInt,
  numberToHex,
} from "viem";
import { AddressType } from "../src/lib/storage/types/address-type";
import { StructType } from "../src/lib/storage/types/struct-type";
import { BigNumberType } from "../src/lib/storage/types/big-number-type";
import { ContractField } from "../src/lib/storage/contractField";
import { BooleanType } from "../src/lib/storage/types/boolean-type";
import type { StorageVisitor } from "../src/lib/reports/storage-visitor";
import { type PropertyChange } from "../src/lib/storage/property-change";
import type { StorageValue } from "../src/lib/storage/values/storage-value";
import type { ValueField } from "../src/lib/storage/values/struct-value";
import { Option } from "nochoices";

class TestReport implements StorageVisitor<string> {
  beforeData: Option<string>;
  afterData: Option<string>;

  constructor() {
    this.beforeData = Option.None();
    this.afterData = Option.None();
  }

  before(): Option<string> {
    return this.beforeData;
  }

  after(): Option<string> {
    return this.afterData;
  }

  checkProp(change: PropertyChange): void {
    change.before
      .map((v) => v.accept(this))
      .ifSome((str) => {
        this.beforeData.replace(str);
      });

    change.after
      .map((v) => v.accept(this))
      .ifSome((str) => {
        this.afterData.replace(str);
      });
  }

  visitAddress(addr: Hex): string {
    return addr.toLowerCase();
  }

  visitArray(inner: StorageValue[]): string {
    return inner.map((v, i) => `[${i}]: ${v.accept(this)}`).join("\n");
  }

  visitBigNumber(n: bigint): string {
    return n.toString();
  }

  visitBoolean(val: boolean): string {
    return val.toString();
  }

  visitBuf(buf: Buffer): string {
    return bytesToHex(buf);
  }

  visitEmpty(): string {
    return "No content.";
  }

  visitStruct(fields: ValueField[]): string {
    return fields
      .map(({ key, value }) => {
        return `${key}=>${value.accept(this)}`;
      })
      .join(", ");
  }

  visitMapping(fields: ValueField[]): string {
    return fields
      .map(({ key, value }) => {
        return `[${key}]: ${value.accept(this)}`;
      })
      .join("\n");
  }
}

describe("MemoryMap", () => {
  const subject = async (file: string, selectors: Hex[] = [], facets: Hex[] = []) => {
    const diff = await fs.readFile(path.join(import.meta.dirname, "data", file));
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    return new StorageChanges(
      json,
      "0x32400084c286cf3e17e7b677ea9583e60a000324",
      selectors,
      facets
    );
  };

  const scenario = async (
    file: string,
    changeName: string,
    selectors: Hex[] = [],
    facets: Hex[] = []
  ): Promise<TestReport> => {
    const memory = await subject(file, selectors, facets);
    const maybeValue = await memory.changeFor(changeName);
    const test = new TestReport();
    const value = maybeValue.unwrap();
    test.checkProp(value);
    return test;
  };

  it("can extract value change for a simple hash value", async () => {
    const test = await scenario(
      "realistic-memory-diff.json",
      "ZkSyncHyperchainBase.s.l2DefaultAccountBytecodeHash"
    );

    expect(test.before().unwrap()).to.eql(
      "0x0100055b041eb28aff6e3a6e0f37c31fd053fc9ef142683b05e5f0aee6934066"
    );
    expect(test.after().unwrap()).to.eql(
      "0x01000563374c277a2c1e34659a2a1e87371bb6d852ce142022d497bfb50b9e32"
    );
  });

  it("can extract value change that is an address", async () => {
    const test = await scenario("realistic-memory-diff.json", "ZkSyncHyperchainBase.s.verifier");

    expect(test.before().unwrap().toLowerCase()).to.eql(
      "0xdd9C826196cf3510B040A8784D85aE36674c7Ed2".toLowerCase()
    );
    expect(test.after().unwrap().toLowerCase()).to.eql(
      "0x9D6c59D9A234F585B367b4ba3C62e5Ec7A6179FD".toLowerCase()
    );
  });

  it("can extract value change for fixed array", async () => {
    const test = await scenario(
      "change-in-deprecated-facets-array.json",
      "ZkSyncHyperchainBase.s.__DEPRECATED_diamondCutStorage"
    );

    const beforeLines = test.before().unwrap().split("\n");

    expect(beforeLines).to.eql([
      "[0]: 0x1000000000000000000000000000000000000000",
      "[1]: 0x2000000000000000000000000000000000000000",
      "[2]: 0x3000000000000000000000000000000000000000",
      "[3]: 0x4000000000000000000000000000000000000000",
      "[4]: 0x5000000000000000000000000000000000000000",
      "[5]: 0x6000000000000000000000000000000000000000",
      "[6]: 0x7000000000000000000000000000000000000000",
    ]);

    const afterLines = test.after().unwrap().split("\n");
    expect(afterLines).to.eql([
      "[0]: 0x1111111111111111111111111111111111111111",
      "[1]: 0x2222222222222222222222222222222222222222",
      "[2]: 0x3333333333333333333333333333333333333333",
      "[3]: 0x4444444444444444444444444444444444444444",
      "[4]: 0x5555555555555555555555555555555555555555",
      "[5]: 0x6666666666666666666666666666666666666666",
      "[6]: 0x7777777777777777777777777777777777777777",
    ]);
  });

  it("can display verifier param changes", async () => {
    const test = await scenario(
      "realistic-memory-diff.json",
      "ZkSyncHyperchainBase.s.__DEPRECATED_verifierParams"
    );

    const beforeLines = test.before().unwrap();
    expect(beforeLines).toMatch(
      /recursionNodeLevelVkHash=>0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080/
    );
    expect(beforeLines).toMatch(
      /recursionLeafLevelVkHash=>0x400a4b532c6f072c00d1806ef299300d4c104f4ac55bd8698ade78894fcadc0a/
    );
    expect(beforeLines).toMatch(/recursionCircuitsSetVksHash=>No content./);

    const afterLines = test.after().unwrap();
    expect(afterLines).toMatch(
      /recursionNodeLevelVkHash=>0xf520cd5b37e74e19fdb369c8d676a04dce8a19457497ac6686d2bb95d94109c8/
    );
    expect(afterLines).toMatch(
      /recursionLeafLevelVkHash=>0x435202d277dd06ef3c64ddd99fda043fc27c2bd8b7c66882966840202c27f4f6/
    );
    expect(afterLines).toMatch(/recursionCircuitsSetVksHash=>No content./);
  });

  it("can display big numbers", async () => {
    const test = await scenario(
      "realistic-memory-diff.json",
      "ZkSyncHyperchainBase.s.protocolVersion"
    );

    expect(test.before().unwrap()).to.eql("22");
    expect(test.after().unwrap()).to.eql("24");
  });

  // it('test mapping keys', () => {
  //   const mapSlot = "0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b"
  //   const key = "0x0e18b681"
  //   const mapSlotBytes = hexToBytes(mapSlot, {size: 32})
  //   const keyBytes = hexToBytes(key, {size: 32})
  //   const buf = Buffer.concat([keyBytes, mapSlotBytes]);
  //
  //   const value = keccak256(buf)
  //   expect(value).to.eql("0x02a257d44d183668a0c30e9d57fecdb34cf2d5f9fbb4a7ae8491d04bf23a7439")
  // })

  it("can display mappings", async () => {
    const test = await scenario("realistic-memory-diff.json", "DiamondStorage.selectorToFacet", [
      "0x0e18b681",
    ]);

    const beforeLines = test.before().unwrap();

    expect(beforeLines).toEqual(
      "[0x0e18b681]: facetAddress=>0x230214f0224c7e0485f348a79512ad00514db1f7, selectorPosition=>0, isFreezable=>false"
    );

    const afterLines = test.after().unwrap();
    expect(afterLines).toEqual(
      "[0x0e18b681]: facetAddress=>0x342a09385e9bad4ad32a6220765a6c333552e565, selectorPosition=>0, isFreezable=>false"
    );
  });

  it("can display multiple mappings", async () => {
    const test = await scenario("realistic-memory-diff.json", "DiamondStorage.selectorToFacet", [
      "0x0e18b681",
      "0x64bf8d66",
      "0x52ef6b2c",
      "0x6c0960f9",
    ]);

    const beforeLines = test.before().unwrap().split("\n");

    expect(beforeLines).toHaveLength(4);
    expect(beforeLines).toEqual(
      expect.arrayContaining([
        "[0x0e18b681]: facetAddress=>0x230214f0224c7e0485f348a79512ad00514db1f7, selectorPosition=>0, isFreezable=>false",
        "[0x64bf8d66]: facetAddress=>0x230214f0224c7e0485f348a79512ad00514db1f7, selectorPosition=>2, isFreezable=>false",
        "[0x52ef6b2c]: facetAddress=>0x10113bb3a8e64f8ed67003126adc8ce74c34610c, selectorPosition=>1, isFreezable=>false",
        "[0x6c0960f9]: facetAddress=>0xa57f9ffd65fc0f5792b5e958df42399a114ec7e7, selectorPosition=>0, isFreezable=>true",
      ])
    );

    const afterLines = test
      .after()
      .unwrap()
      .split("\n")
      .map((l) => l.toLowerCase());
    expect(afterLines).toHaveLength(4);
    expect(afterLines).toEqual(
      expect.arrayContaining([
        "[0x0e18b681]: facetAddress=>0x342a09385e9bad4ad32a6220765a6c333552e565, selectorPosition=>0, isFreezable=>false".toLowerCase(),
        "[0x64bf8d66]: facetAddress=>0x342a09385e9bad4ad32a6220765a6c333552e565, selectorPosition=>1, isFreezable=>false".toLowerCase(),
        "[0x52ef6b2c]: facetAddress=>0x345c6ca2f3e08445614f4299001418f125ad330a, selectorPosition=>3, isFreezable=>false".toLowerCase(),
        "[0x6c0960f9]: facetAddress=>0x7814399116c17f2750ca99cbfd2b75ba9a0793d7, selectorPosition=>1, isFreezable=>true".toLowerCase(),
      ])
    );
  });

  it("can display variable arrays", async () => {
    const test = await scenario("realistic-memory-diff.json", "DiamondStorage.facets", []);

    const before = test
      .before()
      .unwrap()
      .split("\n")
      .map((addr) => addr.toLowerCase());
    expect(before).toHaveLength(4);
    expect(before).toEqual([
      "[0]: 0x230214F0224C7E0485f348a79512ad00514DB1F7".toLowerCase(),
      "[1]: 0x10113bB3a8e64f8eD67003126adC8CE74C34610c".toLowerCase(),
      "[2]: 0xA57F9FFD65fC0F5792B5e958dF42399a114EC7e7".toLowerCase(),
      "[3]: 0xfd3779e6214eBBd40f5F5890351298e123A46BA6".toLowerCase(),
    ]);

    const after = test
      .after()
      .unwrap()
      .split("\n")
      .map((addr) => addr.toLowerCase());
    expect(after).toHaveLength(4);
    expect(after).toEqual([
      "[0]: 0x342a09385E9BAD4AD32a6220765A6c333552e565".toLowerCase(),
      "[1]: 0x345c6ca2F3E08445614f4299001418F125AD330a".toLowerCase(),
      "[2]: 0x7814399116C17F2750Ca99cBFD2b75bA9a0793d7".toLowerCase(),
      "[3]: 0x1a451d9bFBd176321966e9bc540596Ca9d39B4B1".toLowerCase(),
    ]);
  });

  it("can display DiamondStorage.facetToSelectors correctly", async () => {
    const test = await scenario(
      "realistic-memory-diff.json",
      "DiamondStorage.facetToSelectors",
      [],
      ["0x230214f0224c7e0485f348a79512ad00514db1f7"]
    );
    expect(test.before().isSome()).toBe(true);
  });

  it("can display structs correctly", async () => {
    const diff = await fs.readFile(
      path.join(import.meta.dirname, "data", "realistic-memory-diff.json")
    );
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    const prop = new ContractField(
      "myStruct",
      hexToBigInt("0xf78707ba12ab026e6a86b731b9d6b0fc0e151ddd06be4f9f8e940a8fa89bb893"),
      "Some struct",
      new StructType([
        {
          name: "facetAddress",
          type: new AddressType(),
        },
        {
          name: "selectorPosition",
          type: new BigNumberType(2),
        },
        {
          name: "isFreezable",
          type: new BooleanType(),
        },
      ])
    );

    const map = new StorageChanges(
      json,
      "0x32400084c286cf3e17e7b677ea9583e60a000324",
      [],
      [],
      [prop]
    );

    const change = (await map.changeFor("myStruct")).unwrap();

    const test = new TestReport();
    test.checkProp(change);

    expect(test.before().unwrap().toLowerCase()).toEqual(
      "facetAddress=>0xA57F9FFD65fC0F5792B5e958dF42399a114EC7e7, selectorPosition=>3, isFreezable=>true".toLowerCase()
    );
    expect(test.after().unwrap().toLowerCase()).toEqual(
      "facetAddress=>0x7814399116C17F2750Ca99cBFD2b75bA9a0793d7, selectorPosition=>4, isFreezable=>true".toLowerCase()
    );
  });

  it("BLAH", () => {
    // const encoded = encodeAbiParameters(
    //   [{ type: "bytes32" }, { type: "bytes32" }],
    //   [numberToHex(1, { size: 32 }), numberToHex(10, { size: 32 })]
    // )
    console.log(
      hashTypedData({
        domain: {
          name: "Guardians",
          version: "1",
          chainId: 1,
          verifyingContract: numberToHex(1, { size: 20 }),
        },
        primaryType: "ApproveUpgradeGuardians",
        message: {
          id: numberToHex(1, { size: 32 }),
        },
        types: {
          ApproveUpgradeGuardians: [
            {
              name: "id",
              type: "bytes32",
            },
          ],
        },
      })
    );
  });
});
