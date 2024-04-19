import { fetchAbi, lookupAndParse, type Network } from "../lib";
import clitable from "cli-table3";
import path from "node:path";
import { decodeFunctionData, type Abi } from "viem";
import type { Account20String, HashString } from "../schema";
import { prettyPrint } from "@base2/pretty-print-object";

export const AbiMap = new Map<string, Abi>();

export const checkCommand = async (upgradeDirectory: string, parentDirectory?: string) => {
  console.log(`🔦 Checking upgrade with id: ${upgradeDirectory}`);
  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const { fileStatuses, parsedData } = await lookupAndParse(basePath);

  const fileConsistencyTable = new clitable({
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
      fileConsistencyTable.push([`${dirToShow}/`, "", ""]);
    }
    fileConsistencyTable.push(["", fileName, validationStatus]);
  }

  console.log(fileConsistencyTable.toString());

  const { callData, data } = await transformData(parsedData);

  const transactionTable = new clitable({
    head: ["Directory", "Function Name", "Args"],
    colAligns: ["left", "left", "left"],
    colWidths: [20, 15, 60],
  });

  for (const { args, functionName, name } of callData) {
    const dir = path.basename(path.dirname(name));
    transactionTable.push([dir, functionName, args]);
  }
  console.log(transactionTable.toString());
};

const transformData = async (data: Record<string, any>) => {
  const keys = Object.keys(data);
  const callData = [];

  for (const name of keys) {
    if (path.basename(name) === "transactions.json") {
      const upgradeAddress = data[name].upgradeAddress;
      const l1CallData = data[name].l1upgradeCalldata;
      const decoded = await transformCallData(l1CallData, upgradeAddress, "mainnet");
      data[name].l1upgradeCalldata = decoded;

      if ("transparentUpgrade" in data[name]) {
        const { initAddress, initCalldata } = data[name].transparentUpgrade;
        const { args, functionName } = await transformCallData(
          initCalldata,
          initAddress,
          "mainnet"
        );
        data[name].transparentUpgrade.initCalldata = decoded;

        const truncatedArgs = truncateLongStrings(args);
        const formattedArgs = prettyPrint(truncatedArgs, {
          indent: " ",
        });

        callData.push({ name, functionName, args: formattedArgs });
      }
    }

    const parentDirectory = path.basename(path.dirname(name));
    Object.defineProperty(
      data,
      path.join(parentDirectory, path.basename(name)),
      Object.getOwnPropertyDescriptor(data, name) || "error"
    );
    delete data[name];
  }

  return { data, callData };
};

const transformCallData = async (
  callData: HashString,
  contractAddress: Account20String,
  network: Network
) => {
  const abi = AbiMap.has(contractAddress)
    ? AbiMap.get(contractAddress)
    : await fetchAbi(network, contractAddress);
  AbiMap.set(contractAddress, abi);
  return decodeFunctionData({ abi, data: callData as `0x${string}` });
};

function truncateLongStrings(obj: any): any {
  if (typeof obj === "string") {
    return obj.length > 10 ? `${obj.slice(0, 5)}...${obj.slice(-5)}` : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(truncateLongStrings);
  }

  if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      newObj[key] = truncateLongStrings(obj[key]);
    }
    return newObj;
  }
  return obj;
}
