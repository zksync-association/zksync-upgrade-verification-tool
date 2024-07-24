import type { EnvBuilder } from "../lib/env-builder";
import { DIAMOND_ADDRS, type UpgradeChanges, UpgradeImporter } from "../lib";
import { StorageChanges } from "../lib";
import type { Hex } from "viem";
import { Option } from "nochoices";
import { memoryDiffParser, type MemoryDiffRaw } from "../schema/rpc";
import { StringStorageChangeReport } from "../lib/reports/string-storage-change-report";
import { RpcStorageSnapshot } from "../lib";
import { RecordStorageSnapshot } from "../lib";
import { MAIN_CONTRACT_FIELDS } from "../lib/storage/storage-props";
import { FacetsToSelectorsVisitor, ListOfAddressesExtractor } from "../lib/reports/extractors";
import { withSpinner } from "../lib/with-spinner";

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
  const diamondAddress = DIAMOND_ADDRS[env.network];

  const rawMap = await withSpinner(
    async () => {
      const importer = new UpgradeImporter(env.fs());
      const changes = await importer.readFromFiles(dir, env.network);

      return getMemoryPath(preCalculatedPath, env, diamondAddress, changes);
    },
    "Calculating storage changes",
    env
  );

  const changesSnapshot = Option.fromNullable(rawMap.result.post[diamondAddress])
    .map((data) => data.storage)
    .flatten()
    .orElse(() => Option.Some({}))
    .map((s) => new RecordStorageSnapshot(s))
    .unwrap();

  const pre = new RpcStorageSnapshot(env.rpcL1(), diamondAddress);
  const post = pre.apply(changesSnapshot);

  const [facetsPre, facetsPost] = await withSpinner(
    async () => {
      const facetsPre = await MAIN_CONTRACT_FIELDS.facetAddresses
        .extract(pre)
        .then((opt) =>
          opt.map((value) => value.accept(new ListOfAddressesExtractor())).or(Option.Some([]))
        );
      const facetsPost = await MAIN_CONTRACT_FIELDS.facetAddresses
        .extract(post)
        .then((opt) =>
          opt.map((value) => value.accept(new ListOfAddressesExtractor())).or(Option.Some([]))
        );
      return [facetsPre, facetsPost];
    },
    "Searching all facet addresses",
    env
  );

  const allFacets = facetsPre
    .zip(facetsPost)
    .map(([pre, post]) => [...pre, ...post])
    .unwrapOr([]);

  const [selectorsPre, selectorsPost] = await withSpinner(
    async () => {
      const selectorsPre = await MAIN_CONTRACT_FIELDS.facetToSelectors(allFacets)
        .extract(pre)
        .then((opt) =>
          opt
            .map((value) => value.accept(new FacetsToSelectorsVisitor()) as Map<Hex, Hex[]>)
            .or(Option.Some(new Map()))
        );

      const selectorsPost = await MAIN_CONTRACT_FIELDS.facetToSelectors(allFacets)
        .extract(post)
        .then((opt) =>
          opt
            .map((value) => value.accept(new FacetsToSelectorsVisitor()) as Map<Hex, Hex[]>)
            .or(Option.Some(new Map()))
        );
      return [selectorsPre, selectorsPost];
    },
    "Searching all selectors",
    env
  );

  const allSelectors = selectorsPre
    .zip(selectorsPost)
    .map(([pre, post]) => {
      return [...pre.values(), ...post.values()].flat();
    })
    .unwrapOr([]);

  const report = await withSpinner(
    async () => {
      const storageChanges = new StorageChanges(pre, post, allFacets, [...allSelectors]);
      const report = new StringStorageChangeReport(storageChanges, env.colored);
      return await report.format();
    },
    "calculating report",
    env
  );

  env.term().line(report);
}
