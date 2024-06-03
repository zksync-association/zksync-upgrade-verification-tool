import {describe, expect, it} from "vitest";
import {MemoryMap} from "../src/lib/memory-map";
import fs from "node:fs/promises";
import path from "node:path";
import {memoryDiffParser} from "../src/schema/rpc";

describe("MemoryMap", () => {
  const subject = async (file: string) => {
    const diff = await fs.readFile(path.join(import.meta.dirname, "data", file));
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    return new MemoryMap(json, "0x32400084c286cf3e17e7b677ea9583e60a000324");
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

  // it('can show mappings', async () => {
  //   const memory = await subject("realistic-memory-diff.json")
  //   const maybeValue = memory.changeFor("DiamondStorage.selectorToFacet")
  //   const value = maybeValue.unwrap()
  //   // 0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131b
  //   const beforeLines = value.before.unwrap().split("\n");
  //   expect(beforeLines).to.eql([
  //     "[0x0e18b681]: 0x5a3ef282b21e12fe1f4438e5bb158fc5060b160559c5158c6389d62d9fe3d080"
  //   ])
  //
  //   const afterLines = value.after.unwrap().split("\n");
  //   expect(beforeLines).to.eql([
  //     "[0x0e18b681]: 0x342a09385E9BAD4AD32a6220765A6c333552e565"
  //   ])
  // })
})