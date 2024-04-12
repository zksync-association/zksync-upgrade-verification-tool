import { fetchAbi, lookupAndParse, type Network } from "../lib";
import clitable from "cli-table3";
import path, { parse } from "node:path";
import { decodeFunctionData, type Abi } from "viem";
import type { Account20String, HashString, SchemaMap } from "../schema";

export const AbiMap = new Map<string, Abi>();

export const checkCommand = async (
  upgradeDirectory: string,
  network: Network,
  parentDirectory?: string
) => {
  console.log(`🔦 Checking upgrade with id: ${upgradeDirectory}`);
  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const { fileStatuses, parsedData } = await lookupAndParse(basePath);

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

  const transformed = await transformData(parsedData);

  console.log(transformed);
};

const transformData = async (data: Record<string, any>) => {
  const keys = Object.keys(data);

  for (const name of keys) {
    if (path.basename(name) === "transactions.json") {
      const upgradeAddress = data[name].upgradeAddress;
      const l1CallData = data[name].l1upgradeCalldata;
      const decoded = await transformCallData(l1CallData, upgradeAddress, "mainnet");
      data[name].l1upgradeCalldata = decoded;

      if ("transparentUpgrade" in data[name]) {
        const { initAddress, initCalldata } = data[name].transparentUpgrade;
        data[name].transparentUpgrade.initCalldata = await transformCallData(
          initCalldata,
          initAddress,
          "mainnet"
        );
      }
    }
  }

  return data;
};

const transformCallData = async (
  callData: HashString,
  contractAddress: Account20String,
  network: Network
) => {
  if (AbiMap.has(contractAddress)) {
    return AbiMap.get(contractAddress);
  }

  const abi = await fetchAbi(network, contractAddress);
  AbiMap.set(contractAddress, abi);
  return decodeFunctionData({ abi, data: callData as `0x${string}` });
};
