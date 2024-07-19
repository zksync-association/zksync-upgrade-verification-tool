import type { EnvBuilder } from "../lib/env-builder";
import { DIAMOND_ADDRS, type UpgradeChanges, UpgradeImporter } from "../lib";
import { StorageChanges } from "../lib/storage/storage-changes";
import type { Hex } from "viem";
import { Option } from "nochoices";
import { memoryDiffParser, type MemoryDiffRaw } from "../schema/rpc";
import { withSpinner } from "../lib/with-spinner";
import { StringStorageChangeReport } from "../lib/reports/string-storage-change-report";
import { ZksyncEraState } from "../lib/zksync-era-state";
import { RpcStorageSnapshot } from "../lib/storage/rpc-storage-snapshot";
import { RecordStorageSnapshot } from "../lib/storage/record-storage-snapshot";

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
        .debugCallTraceStorage(
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
  const currentState = await withSpinner(
    () => ZksyncEraState.fromBlockchain(env.network, env.l1Client(), env.rpcL1()),
    "Gathering contract data",
    env
  );
  const importer = new UpgradeImporter(env.fs());
  const changes = await importer.readFromFiles(dir, env.network);

  const diamondaddr = DIAMOND_ADDRS[env.network];
  const rawMap = await getMemoryPath(preCalculatedPath, env, diamondaddr, changes);
  const cc = Option.fromNullable(rawMap.result.post[diamondaddr])
    .map(data => data.storage).flatten()
    .orElse(() => Option.Some({}))
    .map(s => new RecordStorageSnapshot(s))
    .unwrap()

  const selectors = new Set<Hex>();
  for (const selector of currentState.allSelectors()) {
    selectors.add(selector);
  }
  for (const selector of changes.allSelectors()) {
    selectors.add(selector);
  }

  const facets = new Set<Hex>();
  for (const addr of currentState.allFacetsAddrs()) {
    facets.add(addr);
  }
  for (const addr of changes.allFacetsAddresses()) {
    facets.add(addr);
  }

  const pre = new RpcStorageSnapshot(env.rpcL1(), diamondaddr);
  const post = pre.apply(cc)

  const storageChanges = new StorageChanges([...selectors], pre, post);

  const report = new StringStorageChangeReport(storageChanges, env.colored);

  env.term().line(await report.format());
}
