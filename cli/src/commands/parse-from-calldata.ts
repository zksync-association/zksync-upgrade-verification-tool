import {lookupAndParse, type Network} from "../lib";
import {AbiSet} from "../lib/abi-set";
import path from "node:path";
import {decodeFunctionData} from "viem";
import {executeUpgradeSchema} from "../schema/execute-upgrade-schema";
import {initCallDataSchema} from "../schema/init-call-data";
import {Diamond} from "../lib/diamond.js";
import {EtherscanClient} from "../lib/etherscan-client.js";


export async function parseFromCalldata(ethscanKey: string, upgradeDirectory: string, parentDirectory: string, network: Network): Promise<void> {
  // const l1Client = new EtherscanClient(ethscanKey, network)
  // const l1Abis = new AbiSet.forL1(, ethscanKey)
  // const l2Abis = AbiSet.forL2('nokey')
  // const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);
  // const upgrade = await lookupAndParse(basePath, network);
  //
  // const {
  //   data,
  //   target
  // } = upgrade.transactions.governanceOperation.calls[0]
  //
  // const diamond = new Diamond(target, l1Abis)
  // await diamond.init()
  //
  // const facetAddr = diamond.selectorToFacet.get(data.substring(0, 10))!
  // const abi = await l1Abis.fetch(facetAddr)
  // const decoded = decodeFunctionData({
  //   abi,
  //   data: data as `0x{string}`
  // })
  //
  // const execUpgrade = executeUpgradeSchema.parse(decoded)
  //
  // const abi2 = await l1Abis.fetch(execUpgrade.args[0].initAddress)
  //
  // const {args: decoded2} = decodeFunctionData({
  //   abi: abi2,
  //   data: execUpgrade.args[0].initCalldata as `0x{string}`
  // })
  //
  // if (!decoded2) {
  //   throw new Error('no decode 2')
  // }
  //
  // const parsed2 = initCallDataSchema.parse(decoded2[0])
  //
  // const hex = parsed2.l2ProtocolUpgradeTx.to.toString(16)
  // const deployAddr = '0x' + '0'.repeat(40 - hex.length) + hex
  // const deploySysContractsAbi = await l2Abis.fetch(deployAddr);
  //
  // const { args: lala} = decodeFunctionData({
  //   abi: deploySysContractsAbi,
  //   data: parsed2.l2ProtocolUpgradeTx.data as `0x{string}`
  // })
  //
  // console.log(lala)
}