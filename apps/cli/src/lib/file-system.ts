import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import { NotADir } from "./errors.js";

export class FileSystem {
  async readFile(path: string): Promise<Buffer> {
    return fs.readFile(path);
  }

  async writeFile(path: string, content: Buffer): Promise<void> {
    return fs.writeFile(path, content);
  }

  async directoryExists(path: string): Promise<boolean> {
    let targetDirStat: Stats;
    try {
      targetDirStat = await fs.stat(path);
    } catch {
      return false;
    }
    return targetDirStat.isDirectory();
  }

  async assertDirectoryExists(path: string): Promise<void> {
    if (!(await this.directoryExists(path))) {
      throw new NotADir(path);
    }
  }
}
