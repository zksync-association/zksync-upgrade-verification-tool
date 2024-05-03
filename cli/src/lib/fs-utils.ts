import fs from "node:fs/promises";
import {NotADir} from "./errors.js";
import * as console from "node:console";

export async function assertDirectoryExists(path: string, originalPath: string = path): Promise<void> {
  let targetDirStat
  try {
    targetDirStat = await fs.stat(path)
  } catch (e) {
    throw new NotADir(originalPath)
  }

  if (!targetDirStat.isDirectory()) {
    throw new NotADir(originalPath)
  }
}