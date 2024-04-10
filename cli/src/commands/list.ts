import { retrieveDirNames } from "../lib";
import path from "node:path";

export const listCommand = async (directory?: string) => {
  const cwd = process.cwd();
  const targetDir = directory ? path.join(cwd, directory) : cwd;
  const dirs = await retrieveDirNames(targetDir);

  console.log(`Directories in ${targetDir}:`);
  console.log(dirs.join("\n"));

  // await containsUpgrade(dirs);
};
