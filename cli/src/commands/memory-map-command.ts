import type { EnvBuilder } from "../lib/env-builder";
import { UpgradeImporter, ZkSyncEraState } from "../lib/index";
import { MemoryMap } from "../lib/memory-map/memory-map";
import chalk from "chalk";
import type {Hex} from "viem";

export async function memoryMapCommand(env: EnvBuilder, dir: string): Promise<void> {
  const state = await ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2());
  const importer = new UpgradeImporter(env.fs());
  const changes = await importer.readFromFiles(dir, env.network);

  const anotherRpc = env.rpcL1();
  const rawMap = await anotherRpc.debugTraceCall(
    "0x0b622a2061eaccae1c664ebc3e868b8438e03f61",
    state.addr,
    changes.upgradeTxHex
  );

  const selectors = new Set<Hex>()

  for (const selector of state.allSelectors()) {
    selectors.add(selector)
  }

  for (const selector of changes.allSelectors()) {
    selectors.add(selector)
  }

  const memoryMap = new MemoryMap(rawMap, state.addr, [...selectors], []);
  const memoryChanges = memoryMap.allChanges();

  for (const change of memoryChanges) {
    console.log("--------------------------");
    console.log(`Property: ${chalk.bold(change.prop.name)}`)
    console.log(`Description: ${change.prop.description}`)
    console.log("")

    console.log("Before:")
    console.log(change.before.unwrapOr("No value"))
    console.log("\nAfter:")
    console.log(change.after.unwrapOr("No value"))

    console.log("--------------------------");
  }
}
