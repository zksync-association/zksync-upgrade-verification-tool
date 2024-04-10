import fs from "node:fs/promises";
import path from "node:path";
import { commonJsonSchema } from "../schema";

// TODO: Add function to import all JSON from a directory
export const retrieveDirNames = async (targetDir: string, verbose = true) => {
  const items = await fs.readdir(targetDir);
  const directories = items.filter(async (file) => await isDirectory(path.join(targetDir, file)));
  const blobs = await Promise.all(
    directories.map(async (dir) => ({
      name: dir,
      isUpgrade: await isUpgradeBlob(path.join(targetDir, dir)),
    }))
  );

  verbose && console.table(blobs);
  return directories;
};

const isDirectory = async (path: string) => {
  const stats = await fs.stat(path);
  return stats.isDirectory();
};

const isFile = async (path: string) => {
  const stats = await fs.stat(path);
  return stats.isFile();
};

const isJson = async (path: string) => {
  const stats = await fs.stat(path);
  return stats.isFile() && path.endsWith(".json");
};

const isUpgradeBlob = async (path: string) => {
  const items = await fs.readdir(path);
  const files = items.filter((file) => file === "common.json");

  if (files.length !== 1) {
    return false;
  }

  try {
    const commonJson = JSON.parse(await fs.readFile(`${path}/common.json`, "utf-8"));
    // TODO: Add a logging system and add debug logs for parse failure
    return commonJsonSchema.safeParse(commonJson) ? true : false;
  } catch (e) {
    console.error(e);
    return false;
  }
};
