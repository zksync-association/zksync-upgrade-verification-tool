import { lookupAndParse } from "../lib";
import clitable from "cli-table3";
import path from "node:path";

export const verifyCommand = async (upgradeDirectory: string, parentDirectory?: string) => {
  console.log(`🔦 Verifying upgrade with id: ${upgradeDirectory}`);

  const basePath = path.join(process.cwd(), parentDirectory || "", upgradeDirectory);

  const { fileStatuses } = await lookupAndParse(basePath);

  const table = new clitable({
    head: ["Directory", "File Name", "Readable?"],
    colAligns: ["left", "left", "center"],
  });

  let currentDir = "";

  for (const { filePath, isValid } of fileStatuses) {
    const relativeFilePath = path.relative(basePath, filePath);
    const fileDirectory = path.dirname(relativeFilePath);
    const fileName = path.basename(filePath);
    const validationStatus = isValid ? "✅" : "❌";

    if (fileDirectory !== currentDir) {
      currentDir = fileDirectory;
      const dirToShow = currentDir.split(path.sep).reduce((acc, cur, index) => {
        return `${acc}${index > 0 ? "│   " : ""}${cur}`;
      }, "");
      table.push([`${dirToShow}/`, "", ""]);
    }
    table.push(["", fileName, validationStatus]);
  }

  console.log(table.toString());
};
