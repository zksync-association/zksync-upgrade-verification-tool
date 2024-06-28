import type { EnvBuilder } from "../lib/env-builder";
import { DIAMOND_ADDRS, type UpgradeChanges, UpgradeImporter } from "../lib";
import { StorageChanges } from "../lib/storage/storage-changes";
import type { Hex } from "viem";
import type { Option } from "nochoices";
import { memoryDiffParser, type MemoryDiffRaw } from "../schema/rpc";
import { withSpinner } from "../lib/with-spinner";
import { StringStorageChangeReport } from "../lib/reports/string-storage-change-report";
import { ZksyncEraState } from "../lib/zksync-era-state";

async function getMemoryPath(
  preCalculatedPath: Option<string>,
  env: EnvBuilder,
  address: Hex,
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
          address,
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
    () => ZksyncEraState.fromBlockchain(env.network, env.l1Client(), env.rpcL1()),
    "Gathering contract data",
    env
  );
  const importer = new UpgradeImporter(env.fs());
  const changes = await importer.readFromFiles(dir, env.network);

  const rawMap = await getMemoryPath(preCalculatedPath, env, DIAMOND_ADDRS[env.network], changes);

  const selectors = new Set<Hex>();
  for (const selector of state.allSelectors()) {
    selectors.add(selector);
  }
  for (const selector of changes.allSelectors()) {
    selectors.add(selector);
  }

  const facets = new Set<Hex>();
  for (const addr of state.allFacetsAddrs()) {
    facets.add(addr);
  }
  for (const addr of changes.allFacetsAddresses()) {
    facets.add(addr);
  }

  const memoryMap = new StorageChanges(
    rawMap,
    DIAMOND_ADDRS[env.network],
    [...selectors],
    ["0x10113bb3a8e64f8ed67003126adc8ce74c34610c"]
  );

  const report = new StringStorageChangeReport(memoryMap, env.colored);

  env.term().line(await report.format());
}
