import type { Sources } from "../schema/index.js";
import path from "node:path";
import fs from "node:fs/promises";

export class ContractData {
  name: string;
  sources: Sources;
  addr: string;

  constructor(name: string, sources: Sources, addr: string) {
    this.name = name;
    this.sources = sources;
    this.addr = addr;
  }

  async writeSources(targetDir: string): Promise<void> {
    for (const fileName in this.sources) {
      const { content } = this.sources[fileName];
      const filePath = path.join(targetDir, fileName);
      await fs.mkdir(path.parse(filePath).dir, { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }

  remapKeys(oldPrefix: string, newPrefix: string): void {
    const record = this.sources;
    const keys = Object.keys(record);
    const newRecord: Sources = {};
    for (const key of keys) {
      const newKey = key.replace(new RegExp(`^${oldPrefix}`), newPrefix);
      newRecord[newKey] = record[key];
    }

    this.sources = newRecord;
  }
}
