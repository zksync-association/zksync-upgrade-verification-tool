import path from "node:path";
import { realpathSync } from "node:fs";

export function basePackageDir() {
  const currentDir = import.meta.dirname
  return realpathSync(path.join(currentDir, "..", ".."), { encoding: "utf8" })
}