import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner.js";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { UpgradeFile } from "../lib/upgrade-file";
import { RpcStorageSnapshot } from "../reports/storage/snapshot";
import { StorageChanges } from "../reports/storage/storage-changes";
import { StringStorageChangeReport } from "../reports/reports/string-storage-change-report";
import { ZksyncEraState } from "../reports/zksync-era-state";
import {
  RpcSystemContractProvider,
  SystemContractList,
} from "../reports/system-contract-providers";
import { LocalFork } from "../reports/local-fork";
import { Diamond } from "../reports/diamond";

export async function storageChangeCommand(
  env: EnvBuilder,
  upgradeFilePath: string
): Promise<void> {
  const upgradeFile = UpgradeFile.fromFile(upgradeFilePath);
  const dataHex = upgradeFile.firstCallData().expect(new Error("Missing calldata"));

  if (!dataHex) {
    throw new Error("Missing calldata");
  }

  const currentState = await withSpinner(
    async () =>
      ZksyncEraState.fromBlockchain(
        env.network,
        await env.newRpcL1(),
        env.l1Client(),
        new RpcSystemContractProvider(env.rpcL2(), env.l2Client())
      ),
    "Gathering current zksync state",
    env
  );

  const localFork = await withSpinner(
    () => LocalFork.create(env.rpcL1().rpcUrl(), env.network),
    "Forking network",
    env
  );

  const [pre, post] = await withSpinner(
    async () => {
      const diamond = await Diamond.create(DIAMOND_ADDRS[env.network], env.l1Client(), env.rpcL1());
      const stateTransitionManager = await diamond.getTransitionManager(
        env.rpcL1(),
        env.l1Client()
      );
      const upgradeHandlerAddress = await stateTransitionManager.upgradeHandlerAddress(env.rpcL1());

      for (const call of upgradeFile.calls) {
        await localFork.execDebugTx(upgradeHandlerAddress, call.target, call.data, call.value);
      }

      const pre = new RpcStorageSnapshot(env.rpcL1(), diamond.address);
      const post = new RpcStorageSnapshot(localFork.rpc(), diamond.address);
      return [pre, post];
    },
    "Simulating upgrade",
    env
  );

  const proposedState = await withSpinner(
    async () =>
      ZksyncEraState.fromBlockchain(
        env.network,
        localFork.rpc(),
        env.l1Client(),
        new SystemContractList([])
      ),
    "Gathering final state",
    env
  );

  const allFacetsData = [...currentState.allFacets(), ...proposedState.allFacets()];
  const allFacetAddresses = allFacetsData.map((f) => f.address);

  const allSelectors = [...currentState.allSelectors(), ...proposedState.allSelectors()];

  const report = await withSpinner(
    async () => {
      const storageChanges = new StorageChanges(pre, post, allFacetAddresses, [...allSelectors]);
      const report = new StringStorageChangeReport(storageChanges, env.colored);
      return await report.format();
    },
    "Calculating report",
    env
  );

  await localFork.tearDown();

  env.term().line(report);
}
