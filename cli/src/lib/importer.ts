import fs from "node:fs/promises";
import path from "node:path";
import { commonJsonSchema, type AllSchemas, type UpgradeManifest } from "../schema";
import { ZodError } from "zod";
import { SCHEMAS, knownFileNames } from "./parser";

export const retrieveDirNames = async (targetDir: string, verbose = true) => {
  const items = await fs.readdir(targetDir, { withFileTypes: true });
  const directories = items.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
  const dirs = await Promise.all(
    directories.map(async (dir) => ({
      name: dir,
      parsed: await isUpgradeBlob(path.join(targetDir, dir)),
    }))
  );

  return dirs;
};

const isUpgradeBlob = async (
  filePath: string
): Promise<{ valid: boolean; parsed?: UpgradeManifest }> => {
  const items = await fs.readdir(filePath);
  const files = items.filter((file) => file === "common.json");

  if (files.length !== 1) {
    return { valid: false };
  }

  try {
    const commonJson = JSON.parse(await fs.readFile(`${filePath}/common.json`, "utf-8"));
    const parsed = commonJsonSchema.parse(commonJson);
    return { valid: true, parsed };
  } catch (e) {
    if (e instanceof ZodError) {
      process.env.DEBUG === "1" && console.error(e.message);
    } else {
      console.error(e);
    }
    // TODO: Add a logging system and add debug logs for parse failure
    return { valid: false };
  }
};

export type FileStatus = {
  filePath: string;
  isValid: boolean;
};

export const lookupAndParse = async (targetDir: string) => {
  const parsedData: any = {};
  const fileStatuses: FileStatus[] = [];

  const traverseDirectory = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await traverseDirectory(entryPath);
      } else {
        const fileName = knownFileNames.parse(entry.name);
        const parser = SCHEMAS[fileName];
        try {
          const fileContents = await fs.readFile(entryPath, "utf8");
          const parsed = parser.parse(JSON.parse(fileContents));
          parsedData[entryPath] = parsed;
          fileStatuses.push({ filePath: entryPath, isValid: true });
        } catch (error) {
          // process.env.DEBUG === "1" && console.error(`Error parsing ${entryPath}:`, error);
          fileStatuses.push({ filePath: entryPath, isValid: false });
        }
      }
    }
  };
  await traverseDirectory(targetDir);

  return { parsedData, fileStatuses };
};
