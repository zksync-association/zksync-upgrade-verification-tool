import type { EnvBuilder } from "../lib/env-builder";
import { type UpgradeChanges, UpgradeImporter, ZkSyncEraState } from "../lib/index";
import { MemoryMap } from "../lib/memory-map/memory-map";
import type { Hex } from "viem";
import { StringMemoryReport } from "../lib/reports/memory-report";
import type { Option } from "nochoices";
import { memoryDiffParser, type MemoryDiffRaw } from "../schema/rpc";
import { withSpinner } from "../lib/with-spinner";

async function getMemoryPath(
  preCalculatedPath: Option<string>,
  env: EnvBuilder,
  state: ZkSyncEraState,
  changes: UpgradeChanges
): Promise<MemoryDiffRaw> {
  return preCalculatedPath
    .map((path) =>
      env
        .fs()
        .readFile(path)
        .then((buf) => JSON.parse(buf.toString()))
        .then((json) => memoryDiffParser.parse(json))
    )
    .unwrapOrElse(() => {
      return env
        .rpcL1()
        .debugTraceCall(
          "0x0b622a2061eaccae1c664ebc3e868b8438e03f61",
          state.addr,
          changes.upgradeCalldataHex.expect(new Error("Missing upgrade calldata"))
        );
    });
}

export async function storageChangeCommand(
  env: EnvBuilder,
  dir: string,
  preCalculatedPath: Option<string>
): Promise<void> {
  const state = await withSpinner(
    () => ZkSyncEraState.create(env.network, env.l1Client(), env.rpcL1(), env.rpcL2()),
    "Gathering contract data"
  );
  const importer = new UpgradeImporter(env.fs());
  const changes = await importer.readFromFiles(dir, env.network);

  const rawMap = await getMemoryPath(preCalculatedPath, env, state, changes);

  const selectors = new Set<Hex>();
  for (const selector of state.allSelectors()) {
    selectors.add(selector);
  }
  for (const selector of changes.allSelectors()) {
    selectors.add(selector);
  }

  const facets = new Set<Hex>();
  for (const addr of state.allFacetsAddresses()) {
    facets.add(addr);
  }
  for (const addr of changes.allFacetsAddresses()) {
    facets.add(addr);
  }

  const memoryMap = new MemoryMap(
    rawMap,
    state.addr,
    [...selectors],
    ["0x10113bb3a8e64f8ed67003126adc8ce74c34610c"]
  );
  const memoryChanges = memoryMap.allChanges();

  const report = new StringMemoryReport(env.colored);

  for (const change of memoryChanges) {
    report.add(change);
  }

  console.log(report.format());
}