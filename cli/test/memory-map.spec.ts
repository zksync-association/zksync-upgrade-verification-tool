import {describe, expect, it} from "vitest";
import {MemoryMap} from "../src/lib/memory-map";
import fs from "node:fs/promises";
import path from "node:path";
import {memoryDiffParser} from "../src/schema/rpc";

describe("MemoryMap", () => {
  it('can extract value change for a simple hash value', async () => {
    const diff = await fs.readFile(path.join(import.meta.dirname, "data", "realistic-memory-diff.json"));
    const json = memoryDiffParser.parse(JSON.parse(diff.toString()));
    const memory = new MemoryMap(json, "0x32400084c286cf3e17e7b677ea9583e60a000324");
    const maybeValue = memory.changeFor("Storage.l2DefaultAccountBytecodeHash")
    const value = maybeValue.unwrap()

    expect(value.before.unwrap()).to.eql("0x0100055b041eb28aff6e3a6e0f37c31fd053fc9ef142683b05e5f0aee6934066")
    expect(value.after.unwrap()).to.eql("0x01000563374c277a2c1e34659a2a1e87371bb6d852ce142022d497bfb50b9e32")
  })
})