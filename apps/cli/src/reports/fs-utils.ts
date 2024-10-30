import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NotADir } from "../lib/errors";

export async function directoryExists(path: string): Promise<boolean> {
  let targetDirStat: Stats;
  try {
    targetDirStat = await fs.stat(path);
  } catch {
    return false;
  }
  return targetDirStat.isDirectory();
}

export async function assertDirectoryExists(
  path: string,
  originalPath: string = path
): Promise<void> {
  if (!(await directoryExists(path))) {
    throw new NotADir(originalPath);
  }
}

export async function cacheDir(): Promise<string> {
  const cacheDir = path.join(os.homedir(), ".cache", "zksync-era-validate");

  await fs.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}
