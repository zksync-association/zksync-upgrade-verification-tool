import {lookupAndParse, type Network} from "../lib";
// import clitable from "cli-table3";
import path, { parse } from "node:path";
import type {Account20String, FacetCutsJson, FacetsJson, HashString, TransactionsJson} from "../schema";
import {cutAction, DiamondChanges} from "../lib/diamond-changes.js";
import {AbiSet} from "../lib/abi-set.js";
import {decodeFunctionData} from "viem";

type HexString = `0x${string}`

async function printFacetChanges (cuts: FacetCutsJson, facets: FacetsJson, network: Network, abiSet: AbiSet): Promise<void> {
  let promises = Object.keys(facets).map(async (facetName): Promise<any> => {
    const f = facets[facetName]
    return abiSet.fetch(f.address, facetName)
  })

  await Promise.all(promises)
  const diamondChanges = new DiamondChanges()

  cuts.forEach(cut => {
    const action = cutAction(cut.action)
    cut.selectors.forEach(selector => {
      diamondChanges.add(selector, action, cut.facet)
    })
  })

  console.log(diamondChanges.format(abiSet))
}

async function printL1DecodedCallData(transactions: TransactionsJson, abiSet: AbiSet): Promise<void> {
  const addr = transactions.upgradeAddress
  const data = transactions.l1upgradeCalldata as HexString

  console.log('addr', addr)

  const abi = await abiSet.fetch(addr)
  const { args } = decodeFunctionData({
    abi,
    data
  })
  console.log(args)
}


export const checkCommand = async (upgradeDirectory: string, parentDirectory?: string, network: Network = 'mainnet') => {
  console.log(`🔦 Checking upgrade with id: ${upgradeDirectory}`);
  const abiSet = new AbiSet(network)

  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const upgrade = await lookupAndParse(basePath, network);

  // Print the names of all the methods being changed
  // if (upgrade.facetCuts && upgrade.facets) {
  //   await printFacetChanges(upgrade.facetCuts, upgrade.facets, network, abiSet)
  // }

  if (upgrade.transactions) {
    await printL1DecodedCallData(upgrade.transactions, abiSet)
  }



  // console.log(t.commonData)
  // console.log(t.transactions)
  // console.log(t.l2Upgrade)




  // const fileConsistencyTable = new clitable({
  //   head: ["Directory", "Fil0xfd3779e6214eBBd40f5F5890351298e123A46BA6e Name", "Readable?"],
  //   colAligns: ["left", "left", "center"],
  // });

  // let currentDir = "";
  // for (const { filePath, isValid } of fileStatuses) {
  //   const relativeFilePath = path.relative(basePath, filePath);
  //   const fileDirectory = path.dirname(relativeFilePath);
  //   const fileName = path.basename(filePath);
  //   const validationStatus = isValid ? "✅" : "❌";
  //
  //   if (fileDirectory !== currentDir) {
  //     currentDir = fileDirectory;
  //     const dirToShow = currentDir.split(path.sep).reduce((acc, cur, index) => {
  //       return `${acc}${index > 0 ? "│   " : ""}${cur}`;
  //     }, "");
  //     fileConsistencyTable.push([`${dirToShow}/`, "", ""]);
  //   }
  //   fileConsistencyTable.push(["", fileName, validationStatus]);
  // }

  // console.log(fileConsistencyTable.toString());

  // const { callData, data } = await transformData(parsedData);

  // const transactionTable = new clitable({
  //   head: ["Directory", "Function Name", "Args"],
  //   colAligns: ["left", "left", "left"],
  //   colWidths: [20, 15, 60],
  // });

  // for (const { args, functionName, name } of callData) {
  //   const dir = path.basename(path.dirname(name));
  //   transactionTable.push([dir, functionName, args]);
  // }
  // console.log(transactionTable.toString());
};

// const transformOneData = async (descriptor: UpgradeDescriptor): Promise<void> => {
//
// }

// const transformData = async (data: Record<string, any>) => {
//   const keys = Object.keys(data);
//   const callData = [];
//
//   for (const name of keys) {
//     if (path.basename(name) === "transactions.json") {
//       const upgradeAddress = data[name].upgradeAddress;
//       const l1CallData = data[name].l1upgradeCalldata;
//       const decoded = await transformCallData(l1CallData, upgradeAddress, "mainnet");
//       data[name].l1upgradeCalldata = decoded;
//
//       if ("transparentUpgrade" in data[name]) {
//         const { initAddress, initCalldata } = data[name].transparentUpgrade;
//         const { args, functionName } = await transformCallData(
//           initCalldata,
//           initAddress,
//           "mainnet"
//         );
//         data[name].transparentUpgrade.initCalldata = decoded;
//
//         const truncatedArgs = truncateLongStrings(args);
//         const formattedArgs = prettyPrint(truncatedArgs, {
//           indent: " ",
//         });
//
//         callData.push({ name, functionName, args: formattedArgs });
//       }
//     }
//
//     const parentDirectory = path.basename(path.dirname(name));
//     Object.defineProperty(
//       data,
//       path.join(parentDirectory, path.basename(name)),
//       Object.getOwnPropertyDescriptor(data, name) || "error"
//     );
//     delete data[name];
//   }
//
//   return { data, callData };
// };
//
// const transformCallData = async (
//   callData: HashString,
//   contractAddress: Account20String,
//   network: Network
// ) => {
//   const abi = AbiMap.has(contractAddress)
//     ? AbiMap.get(contractAddress)
//     : await fetchAbi(network, contractAddress);
//   AbiMap.set(contractAddress, abi);
//   return decodeFunctionData({ abi, data: callData as `0x${string}` });
// };
//
// function truncateLongStrings(obj: any): any {
//   if (typeof obj === "string") {
//     return obj.length > 10 ? `${obj.slice(0, 5)}...${obj.slice(-5)}` : obj;
//   }
//   if (Array.isArray(obj)) {
//     return obj.map(truncateLongStrings);
//   }
//   if (typeof obj === "object" && obj !== null) {
//     const newObj: any = {};
//     for (const key of Object.keys(obj)) {
//       newObj[key] = truncateLongStrings(obj[key]);
//     }
//     return newObj;
//   }
//   return obj;
// }
