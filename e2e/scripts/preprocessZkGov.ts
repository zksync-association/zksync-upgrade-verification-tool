/**
 * This script prepares the zk-gov contracts for compilation by hardhat.
 *
 * For the L2 contracts, it:
 * 1. Changes imports that start with 'src/' to be relative imports,
 *    as hardhat does not support them.
 * 2. Changes openzeppelin imports to use v4, as L1 contracts are using v5.
 *
 * This will generate a new folder with the modified contracts. This folder
 * should not be committed.
 */

import path from "node:path";
import { glob } from "glob";
import ora from "ora";
import fs from "node:fs";
import chalk from "chalk";

const ZK_GOV_PATH = path.join(import.meta.dirname, "..", "contracts", "zk-gov");
const TARGET_NAME = "zk-gov-preprocessed";

async function main() {
  console.log(chalk.cyan("🚀 Preprocess zk-gov contracts started"));
  const contractPaths = getContractPaths();
  const targetPath = getTargetPath();
  resetTargetPath(targetPath);

  for (const contract of contractPaths) {
    const spinner = ora(`Processing ${contract}`).start();

    // Read file content
    let content = fs.readFileSync(contract, "utf-8");

    // Modify src imports
    let importCount = 0;
    content = content.replace(/import\s+{[^}]+}\s+from\s+"(src\/[^"]+)";/g, (match, importPath) => {
      importCount++;
      const contractDir = path.dirname(contract);
      const srcIndex = contractDir.lastIndexOf("src");
      if (srcIndex === -1) {
        spinner.warn(chalk.yellow(`No 'src' folder found in path: ${contractDir}`));
        return match; // If no 'src' folder found, leave import unchanged
      }

      const srcPath = contractDir.slice(0, srcIndex - 1); // Don't include 'src'
      let newImportPath = path.relative(contractDir, path.join(srcPath, importPath));
      if (!newImportPath.startsWith(".")) {
        newImportPath = `./${newImportPath}`;
      }

      const newImport = match.replace(importPath, newImportPath);
      return newImport;
    });

    // Modify openzeppelin imports only if contract is in l2-contracts
    if (isContractInL2(contract)) {
      content = content.replace(/import\s+{[^}]+}\s+from\s+"@openzeppelin[^"]+";/g, (match) => {
        importCount++;
        const newImport = match.replace("@openzeppelin", "@openzeppelin-v4");
        return newImport;
      });
    }

    // Write modified content to target file
    const targetFilePath = path.join(targetPath, path.relative(ZK_GOV_PATH, contract));
    writeFile(targetFilePath, content);

    spinner.succeed(`Processed ${contract} (${importCount} imports modified)`);
  }
}

function getContractPaths() {
  const l1contracts = path.join(ZK_GOV_PATH, "l1-contracts", "src", "**", "*.sol");
  const l2contracts = path.join(ZK_GOV_PATH, "l2-contracts", "src", "**", "*.sol");
  const contractPaths = glob.sync([l1contracts, l2contracts]);
  return contractPaths;
}

function getTargetPath() {
  return path.join(ZK_GOV_PATH, "..", TARGET_NAME);
}

function resetTargetPath(targetPath: string) {
  if (fs.existsSync(targetPath)) {
    fs.rmdirSync(targetPath, { recursive: true });
  }
  fs.mkdirSync(targetPath);
}

function isContractInL2(contractPath: string) {
  return contractPath.includes("l2-contracts");
}

function writeFile(filePath: string, content: string) {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

main()
  .then(() => {
    console.log(chalk.cyan("✅ Preprocess zk-gov completed"));
  })
  .catch((error) => {
    console.error(error);
    console.log(chalk.red("❌ Preprocess zk-gov failed"));
    process.exit(1);
  });
