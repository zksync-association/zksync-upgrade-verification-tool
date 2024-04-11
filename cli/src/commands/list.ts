import { retrieveDirNames } from "../lib";
import path from "node:path";
import Table from "cli-table3";

export const listCommand = async (directory: string, hideNonUpgrades = false) => {
  console.log(`🔎 Checking directories in ${path.dirname(directory)} for upgrades...`);
  const cwd = process.cwd();
  const targetDir = directory ? path.resolve(cwd, directory) : cwd;
  const dirs = await retrieveDirNames(targetDir, true);

  const table = new Table({
    head: ["Name", "Is Upgrade?", "Protocol Version", "Created at", "Directory"],
  });

  for (const { name, parsed } of dirs) {
    const row = [
      parsed.parsed?.name ?? "N/A",
      parsed.valid ? "Yes" : "No",
      parsed.parsed?.protocolVersion ?? "N/A",
      parsed.parsed
        ? new Date(parsed.parsed.creationTimestamp * 1000).toISOString().slice(0, 10)
        : "N/A",
      name,
    ];
    if (hideNonUpgrades && !parsed.valid) {
      continue;
    }
    table.push(row);
  }

  if (table.length === 0) {
    console.log("ℹ️  No upgrades found in current directory.");
    return;
  }

  console.log(table.toString());
};
