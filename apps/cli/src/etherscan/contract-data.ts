import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";


const sourcesSchema = z.record(z.string(), z.object({ content: z.string() }));
export type Sources = z.infer<typeof sourcesSchema>;

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
    for (const [fileName, { content }] of Object.entries(this.sources)) {
      const filePath = path.join(targetDir, fileName);
      await fs.mkdir(path.parse(filePath).dir, { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }

  remapKeys(oldPrefix: string, newPrefix: string): void {
    const newRecord: Sources = {};
    for (const [key, value] of Object.entries(this.sources)) {
      const newKey = key.startsWith(oldPrefix) ? key.replace(oldPrefix, newPrefix) : key;
      newRecord[newKey] = value;
    }

    this.sources = newRecord;
  }
}
