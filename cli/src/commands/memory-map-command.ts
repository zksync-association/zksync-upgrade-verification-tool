import type { EnvBuilder } from "../lib/env-builder";
import { UpgradeImporter, ZkSyncEraState } from "../lib/index";
import { MemoryMap } from "../lib/memory-map/memory-map";
import type {Hex} from "viem";
import {StringMemoryReport} from "../lib/reports/memory-report";
import type {Option} from "nochoices";
import {memoryDiffParser} from "../schema/rpc";

export async function memoryMapCommand(env: EnvBuilder, dir: string, precalcualtedDir: Option<string>): Promise<void> {
  const state = await ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2());
  const importer = new UpgradeImporter(env.fs());
  const changes = await importer.readFromFiles(dir, env.network);

  const anotherRpc = env.rpcL1();
  const rawMap = await precalcualtedDir
    .map(path => env.fs().readFile(path)
      .then(buf => JSON.parse(buf.toString()))
      .then(json => memoryDiffParser.parse(json))
    ).unwrapOrElse(() => {
      return anotherRpc.debugTraceCall(
        "0x0b622a2061eaccae1c664ebc3e868b8438e03f61",
        state.addr,
        changes.upgradeCalldataHex.expect(new Error("Missing upgrade calldata"))
      )
    })

    await anotherRpc.debugTraceCall(
    "0x0b622a2061eaccae1c664ebc3e868b8438e03f61",
    state.addr,
    changes.upgradeCalldataHex.expect(new Error("Missing upgrade calldata"))
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

  const report = new StringMemoryReport()

  for (const change of memoryChanges) {
    report.add(change)
  }

  console.log(report.format())
}
