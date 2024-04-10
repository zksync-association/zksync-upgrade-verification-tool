import fs from "node:fs/promises";
import path from "node:path";
import Table from "cli-table3";
import { commonJsonSchema, type UpgradeManifest } from "../schema";
import { ZodError } from "zod";

export const retrieveDirNames = async (targetDir: string, verbose = true) => {
  const items = await fs.readdir(targetDir, { withFileTypes: true });
  const directories = items.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
  const blobs = await Promise.all(
    directories.map(async (dir) => ({
      name: dir,
      parsed: await isUpgradeBlob(path.join(targetDir, dir)),
    }))
  );

  if (verbose) {
    const table = new Table({
      head: ["Name", "Is Upgrade?", "Protocol Version", "Created at", "Directory"],
      // , colWidths: [100, 200]
    });

    for (const { name, parsed } of blobs) {
      const row = [
        parsed.parsed?.name ?? "N/A",
        parsed.valid ? "Yes" : "No",
        parsed.parsed?.protocolVersion ?? "N/A",
        parsed.parsed
          ? new Date(parsed.parsed.creationTimestamp * 1000).toISOString().slice(0, 10)
          : "N/A",
        name,
      ];
      table.push(row);
    }

    console.log(table.toString());
  }
  return directories;
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
      console.error(e.message);
    } else {
      console.error(e);
    }
    // TODO: Add a logging system and add debug logs for parse failure
    return { valid: false };
  }
};
