import type {EnvBuilder} from "../lib/env-builder";
import {UpgradeChanges, UpgradeImporter, ZkSyncEraState} from "../lib/index";
import {RpcClient} from "../lib/rpc-client";
import {MemoryMap} from "../lib/memory-map/memory-map";
import CliTable from "cli-table3";
import chalk from "chalk";

export async function memoryMapCommand (env: EnvBuilder, dir: string): Promise<void> {
  const state = await ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2())
  const importer = new UpgradeImporter(env.fs())
  const changes = await importer.readFromFiles(dir, env.network)

  const anotherRpc = new RpcClient("https://docs-demo.quiknode.pro/")
  const rawMap = await anotherRpc.debugTraceCall("0x0b622a2061eaccae1c664ebc3e868b8438e03f61", state.addr, changes.upgradeTxHex, env.fs())

  const memoryMap = new MemoryMap(rawMap, state.addr, ["0x0e18b681"])
  const memoryChanges = memoryMap.allChanges()


  for (const change of memoryChanges) {
    const table = new CliTable()

    table.push([{content: chalk.red(change.prop.name), colSpan: 2}],)
    table.push([{content: change.prop.description, colSpan: 2}])
    table.push([change.before.unwrapOr("No value"), change.after.unwrapOr("No value")])

    console.log(table.toString())
  }
}