import fs from "node:fs/promises";
import { NotADir } from "./errors.js";
import type { Stats } from "node:fs";

export async function directoryExists(path: string): Promise<boolean> {
  let targetDirStat: Stats;
  try {
    targetDirStat = await fs.stat(path);
  } catch (e) {
    return false;
  }

  return targetDirStat.isDirectory();
}

export async function assertDirectoryExists(
  path: string,
  originalPath: string = path
): Promise<void> {
  if (!await directoryExists(path)) {
    throw new NotADir(originalPath);
  }
}
