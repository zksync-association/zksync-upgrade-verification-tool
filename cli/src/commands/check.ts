import {fetchAbi, lookupAndParse, type Network, type UpgradeDescriptor} from "../lib";
import clitable from "cli-table3";
import path, { parse } from "node:path";
import {decodeFunctionData, type Abi, parseAbi, toFunctionSelector, type AbiFunction} from "viem";
import type {Account20String, FacetCutsJson, FacetsJson, HashString} from "../schema";
// import { prettyPrint } from "@base2/pretty-print-object";

export const abiMap = new Map<string, Abi>();
const functionSelectors = new Map<string, AbiFunction>

async function printFacetChanges (cuts: FacetCutsJson, facets: FacetsJson, network: Network): Promise<void> {
  // first I'll load the abis to get the names of the functions
  let promises = Object.keys(facets).map(async (key): Promise<void> => {
    const f = facets[key]
    const abi = await fetchAbi(network, f.address)
    abiMap.set(f.address, abi)
  })
  await Promise.all(promises)

  // find all selectors
  cuts.forEach(cut => {
    if (cut.facet === '0x0000000000000000000000000000000000000000') return
    let abi = abiMap.get(cut.facet)
    if (!abi) {
      throw new Error('no abi')
    }

    const functions = abi.filter(a => a.type === 'function') as AbiFunction[]

    functions.forEach(fn => {
      const selector = toFunctionSelector(fn)
      functionSelectors.set(selector, fn)
    })
  })

  cuts.forEach(cut => {
    const actions = ['added', 'changed', 'removed']
    const facetName = Object.keys(facets).find(k => facets[k].address === cut.facet) || 'Unknown facet'

    console.log(`${facetName} (${cut.facet}):`)
    cut.selectors.forEach(selector => {
      const name = functionSelectors.get(selector)?.name || 'unknown name'
      console.log(`  ${name} (${selector}) ${actions[cut.action]}`)
    })
    console.log(`---`)
  })


}

export const checkCommand = async (upgradeDirectory: string, parentDirectory?: string, network: string = 'mainnet2') => {
  console.log(`🔦 Checking upgrade with id: ${upgradeDirectory}`);

  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);

  const upgrade = await lookupAndParse(basePath, network);


  // Print the names of all the methods being changed
  if (upgrade.facetCuts && upgrade.facets) {
    await printFacetChanges(upgrade.facetCuts, upgrade.facets, 'mainnet')
  }

  // console.log(t.commonData)
  // console.log(t.transactions)
  // console.log(t.l2Upgrade)




  // const fileConsistencyTable = new clitable({
  //   head: ["Directory", "File Name", "Readable?"],
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
