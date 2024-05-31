import type {EnvBuilder} from "../lib/env-builder";
import {UpgradeChanges, UpgradeImporter, ZkSyncEraState} from "../lib/index";
import {RpcClient} from "../lib/rpc-client";

export async function memoryMapCommand (env: EnvBuilder, dir: string): Promise<void> {
  const state = await ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2())
  const importer = new UpgradeImporter(env.fs())
  const changes = await importer.readFromFiles(dir, env.network)

  const anotherRpc = new RpcClient("https://docs-demo.quiknode.pro/")
  await anotherRpc.debugTraceCall("0x0b622a2061eaccae1c664ebc3e868b8438e03f61", state.addr, changes.upgradeTxHex, env.fs())

  console.log(`Usage: memory-map-command`);
}