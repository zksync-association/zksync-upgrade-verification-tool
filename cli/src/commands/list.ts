import { retrieveDirNames } from "../lib";
import path from "node:path";

export const listCommand = async (directory?: string) => {
  console.log(`🔎 Checking directories in ${directory ?? process.cwd()} for upgrades...`);
  const cwd = process.cwd();
  const targetDir = directory ? path.join(cwd, directory) : cwd;
  await retrieveDirNames(targetDir, true);
};
