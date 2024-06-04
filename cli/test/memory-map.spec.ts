import {describe, expect, it} from "vitest";
import {MemoryMap} from "../src/lib/memory-map/memory-map";
import fs from "node:fs/promises";
import path from "node:path";
import {memoryDiffParser} from "../src/schema/rpc";
import {type Hex, hexToBigInt, hexToBytes, keccak256} from "viem";
import {AddressType} from "../src/lib/memory-map/types/address-type";
import {StructType} from "../src/lib/memory-map/types/struct-type";
import {BigNumberType} from "../src/lib/memory-map/types/big-number-type";
import {Property} from "../src/lib/memory-map/property";
import {BooleanType} from "../src/lib/memory-map/types/boolean-type";

describe("MemoryMap", () => {
  const subject = async (file: string, selectors: Hex[] = []) => {
    const diff = await fs.readFile(path.join(import.meta.dirname, "data", file));
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    return new MemoryMap(json, "0x32400084c286cf3e17e7b677ea9583e60a000324", selectors);
  }

  it('can extract value change for a simple hash value', async () => {
    const memory = await subject("realistic-memory-diff.json")
    const maybeValue = memory.changeFor("Storage.l2DefaultAccountBytecodeHash")
    const value = maybeValue.unwrap()

    expect(value.before.unwrap()).to.eql("0x0100055b041eb28aff6e3a6e0f37c31fd053fc9ef142683b05e5f0aee6934066")
    expect(value.after.unwrap()).to.eql("0x01000563374c277a2c1e34659a2a1e87371bb6d852ce142022d497bfb50b9e32")
  })

  it('can extract value change that is an address', async () => {
    const memory = await subject("realistic-memory-diff.json")
    const maybeValue = memory.changeFor("Storage.verifier")
    const value = maybeValue.unwrap()

    expect(value.before.unwrap().toLowerCase()).to.eql("0xdd9C826196cf3510B040A8784D85aE36674c7Ed2".toLowerCase())
    expect(value.after.unwrap().toLowerCase()).to.eql("0x9D6c59D9A234F585B367b4ba3C62e5Ec7A6179FD".toLowerCase())
  })

  it('can extract value change for fixed array', async () => {
    const memory = await subject("change-in-deprecated-facets-array.json")
    const maybeValue = memory.changeFor("Storage.__DEPRECATED_diamondCutStorage")
    const value = maybeValue.unwrap()

    const beforeLines = value.before.unwrap().split("\n")

    expect(beforeLines).to.eql([
      "[0]: 0x1000000000000000000000000000000000000000",
      "[1]: 0x2000000000000000000000000000000000000000",
      "[2]: 0x3000000000000000000000000000000000000000",
      "[3]: 0x4000000000000000000000000000000000000000",
      "[4]: 0x5000000000000000000000000000000000000000",
      "[5]: 0x6000000000000000000000000000000000000000",
      "[6]: 0x7000000000000000000000000000000000000000",
    ])

    const afterLines = value.after.unwrap().split("\n")
    expect(afterLines).to.eql([
      "[0]: 0x1111111111111111111111111111111111111111",
      "[1]: 0x2222222222222222222222222222222222222222",
      "[2]: 0x3333333333333333333333333333333333333333",
      "[3]: 0x4444444444444444444444444444444444444444",
      "[4]: 0x5555555555555555555555555555555555555555",
      "[5]: 0x6666666666666666666666666666666666666666",
      "[6]: 0x7777777777777777777777777777777777777777",
    ])
  })

  it('can show verifier param changes', async () => {
    const memory = await subject("realistic-memory-diff.json")
    const maybeValue = memory.changeFor("Storage.verifierParams")
    const value = maybeValue.unwrap()

    const beforeLines = value.before.unwrap().split("\n");
    expect(beforeLines).to.eql([
      ".recursionNodeLevelVkHash: 0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080",
      ".recursionLeafLevelVkHash: 0x400a4b532c6f072c00d1806ef299300d4c104f4ac55bd8698ade78894fcadc0a",
      ".recursionCircuitsSetVksHash: Not affected",
    ])

    const afterLines = value.after.unwrap().split("\n");
    expect(afterLines).to.eql([
      ".recursionNodeLevelVkHash: 0xf520cd5b37e74e19fdb369c8d676a04dce8a19457497ac6686d2bb95d94109c8",
      ".recursionLeafLevelVkHash: 0x435202d277dd06ef3c64ddd99fda043fc27c2bd8b7c66882966840202c27f4f6",
      ".recursionCircuitsSetVksHash: Not affected",
    ])
  })

  it('can show big numbers', async () => {
    const memory = await subject("realistic-memory-diff.json")
    const maybeValue = memory.changeFor("Storage.protocolVersion")
    const value = maybeValue.unwrap()

    expect(value.before.unwrap()).to.eql("22")
    expect(value.after.unwrap()).to.eql("24")
  })

  it('test mapping keys', () => {
    const mapSlot = "0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b"
    const key = "0x0e18b681"
    const mapSlotBytes = hexToBytes(mapSlot, {size: 32})
    const keyBytes = hexToBytes(key, {size: 32})
    //
    const buf = Buffer.concat([keyBytes, mapSlotBytes]);
    console.log(buf.toString('hex'))
    const value = keccak256(buf)
    // 0x0e18b60000000000000000000000000000000000000000000000000000000000c8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b
    // const value = keccak256("0x0e18b68100000000000000000000000000000000000000000000000000000000c8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b")
    expect(value).to.eql("0x02a257d44d183668a0c30e9d57fecdb34cf2d5f9fbb4a7ae8491d04bf23a7439")

    // const arrSlot = keccak256("0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131d")
    // console.log(arrSlot)
  })

  it('can show mappings', async () => {
    const memory = await subject("realistic-memory-diff.json", ["0x0e18b681"])
    const maybeValue = memory.changeFor("DiamondStorage.selectorToFacet")
    const value = maybeValue.unwrap()

    const beforeLines = value.before.unwrap().split("\n").map(l => l.toLowerCase());
    expect(beforeLines).to.eql([
      "[0x0e18b681]: {facetAddress=>0x230214f0224c7e0485f348a79512ad00514db1f7,selectorPosition=>0,isFreezable=>false}".toLowerCase()
    ])

    const afterLines = value.after.unwrap().split("\n").map(l => l.toLowerCase());
    expect(afterLines).to.eql([
      "[0x0e18b681]: {facetAddress=>0x342a09385E9BAD4AD32a6220765A6c333552e565,selectorPosition=>0,isFreezable=>false}".toLowerCase()
    ])
  })

  it('can show multiple mappings', async () => {
    const memory = await subject("realistic-memory-diff.json", [
      "0x0e18b681",
      "0x64bf8d66",
      "0x52ef6b2c",
      "0x6c0960f9"
    ])
    const maybeValue = memory.changeFor("DiamondStorage.selectorToFacet")
    const value = maybeValue.unwrap()

    const beforeLines = value.before.unwrap().split("\n").map(l => l.toLowerCase());
    expect(beforeLines).toHaveLength(4)
    expect(beforeLines).toEqual(expect.arrayContaining([
      "[0x0e18b681]: {facetAddress=>0x230214F0224C7E0485f348a79512ad00514DB1F7,selectorPosition=>0,isFreezable=>false}".toLowerCase(),
      "[0x64bf8d66]: {facetAddress=>0x230214F0224C7E0485f348a79512ad00514DB1F7,selectorPosition=>2,isFreezable=>false}".toLowerCase(),
      "[0x52ef6b2c]: {facetAddress=>0x10113bB3a8e64f8eD67003126adC8CE74C34610c,selectorPosition=>1,isFreezable=>false}".toLowerCase(),
      "[0x6c0960f9]: {facetAddress=>0xA57F9FFD65fC0F5792B5e958dF42399a114EC7e7,selectorPosition=>0,isFreezable=>true}".toLowerCase(),
    ]))

    const afterLines = value.after.unwrap().split("\n").map(l => l.toLowerCase());
    expect(afterLines).toHaveLength(4)
    expect(afterLines).toEqual(expect.arrayContaining([
      "[0x0e18b681]: {facetAddress=>0x342a09385E9BAD4AD32a6220765A6c333552e565,selectorPosition=>0,isFreezable=>false}".toLowerCase(),
      "[0x64bf8d66]: {facetAddress=>0x342a09385E9BAD4AD32a6220765A6c333552e565,selectorPosition=>1,isFreezable=>false}".toLowerCase(),
      "[0x52ef6b2c]: {facetAddress=>0x345c6ca2F3E08445614f4299001418F125AD330a,selectorPosition=>3,isFreezable=>false}".toLowerCase(),
      "[0x6c0960f9]: {facetAddress=>0x7814399116C17F2750Ca99cBFD2b75bA9a0793d7,selectorPosition=>1,isFreezable=>true}".toLowerCase(),
    ]))
  })


  it("can show structs correctly", async () => {
    const diff = await fs.readFile(path.join(import.meta.dirname, "data", "realistic-memory-diff.json"));
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    const prop = new Property(
      "myStruct",
      hexToBigInt("0xf78707ba12ab026e6a86b731b9d6b0fc0e151ddd06be4f9f8e940a8fa89bb893"),
      "Some struct",
      new StructType([
        {
          name: "facetAddress",
          type: new AddressType()
        },
        {
          name: "selectorPosition",
          type: new BigNumberType(2, 20)
        },
        {
          name: "isFreezable",
          type: new BooleanType(22)
        }
      ])
    )

    const map = new MemoryMap(json, "0x32400084c286cf3e17e7b677ea9583e60a000324", [], [prop])

    const change = map.changeFor("myStruct").unwrap()

    expect(change.before.unwrap().toLowerCase()).toEqual("{facetAddress=>0xA57F9FFD65fC0F5792B5e958dF42399a114EC7e7,selectorPosition=>3,isFreezable=>true}".toLowerCase())
    expect(change.after.unwrap().toLowerCase()).toEqual("{facetAddress=>0x7814399116C17F2750Ca99cBFD2b75bA9a0793d7,selectorPosition=>4,isFreezable=>true}".toLowerCase())
  })
})