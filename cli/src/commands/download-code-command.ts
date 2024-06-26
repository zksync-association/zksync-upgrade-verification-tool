import type { EnvBuilder } from "../lib/env-builder.js";
import { withSpinner } from "../lib/with-spinner";
import { ZksyncEraState, type HexEraPropName } from "../lib/zksync-era-state";
import path from "node:path";
import { hexToBigInt, hexToBytes } from "viem";
import { hexAreEq, ZkSyncEraDiff } from "../lib/zk-sync-era-diff";
import { ADDRESS_ZERO, ContractData, OPEN_ZEP_PROXY_IMPL_SLOT } from "../lib";
import { MalformedUpgrade } from "../lib/errors";
import type {GitContractsRepo} from "../lib/git-contracts-repo";

async function downloadAllCode (diff: ZkSyncEraDiff, env: EnvBuilder, targetDir: string, repo: GitContractsRepo) {
  const facets = [...diff.removedFacets(), ...diff.upgradedFacets(), ...diff.addedFacets()];

  for (const facet of facets) {
    await facet.oldAddress
      .map(async (addr): Promise<void> => {
        const contract = await env.l1Client().getSourceCode(addr);
        await contract.writeSources(path.join(targetDir, "current", "facets", contract.name));
      })
      .unwrapOr(Promise.resolve());

    await facet.newAddress
      .map(async (addr): Promise<void> => {
        const contract = await env.l1Client().getSourceCode(addr);
        await contract.writeSources(path.join(targetDir, "proposed", "facets", contract.name));
      })
      .unwrapOr(Promise.resolve());
  }

  const [defaultAccount, maybeDefaultAccount] = diff.hexAttrDiff("l2DefaultAccountBytecodeHash");
  if (maybeDefaultAccount.isSomeAnd((v) => !hexAreEq(v, defaultAccount))) {
    const sources = await repo.downloadSystemContract("DefaultAccount");
    const contract = new ContractData("DefaultAA", sources, ADDRESS_ZERO);
    await contract.writeSources(path.join(targetDir, "proposed", "defaultAccountAbstraction"));
  }

  const [bootloader, maybeBootloader] = diff.hexAttrDiff("l2BootloaderBytecodeHash");
  if (maybeBootloader.isSomeAnd((v) => !hexAreEq(v, bootloader))) {
    const sources = await repo.downloadSystemContract("proved_batch");
    const contract = new ContractData("Bootloader", sources, ADDRESS_ZERO);
    await contract.writeSources(path.join(targetDir, "proposed", "bootloader"));
  }

  const sysContractChanges = await diff.systemContractChanges();

  for (const change of sysContractChanges) {
    const current = await change.downloadCurrentCode(env.l2Client());
    await current.writeSources(path.join(targetDir, "current", "systemContracts", change.name));

    const proposed = await change.downloadProposedCode(repo);
    await proposed.writeSources(path.join(targetDir, "proposed", "systemContracts", change.name));
  }

  const proxiedContracts: HexEraPropName[] = [
    "bridgeHubAddress",
    "blobVersionedHashRetriever",
    "stateTransitionManagerAddress",
    "baseTokenBridgeAddress",
  ];

  for (const elem of proxiedContracts) {
    const [currentValue, maybeProposed] = diff.hexAttrDiff(elem);
    if (maybeProposed.isSome()) {
      const implBigint = hexToBigInt(OPEN_ZEP_PROXY_IMPL_SLOT);
      const before = await env.rpcL1().storageRead(currentValue, implBigint);
      const after = await env.rpcL1().storageRead(maybeProposed.unwrap(), implBigint);
      if (hexToBigInt(before) !== 0n && hexToBigInt(after) !== 0n && before !== after) {
        const current = await env.l1Client().getSourceCode(before);
        await current.writeSources(path.join(targetDir, "current", elem.replace("Address", "")));

        const proposed = await env.l1Client().getSourceCode(after);
        await proposed.writeSources(path.join(targetDir, "proposed", elem.replace("Address", "")));
      }
    }
  }

  const directDownloadContracts: HexEraPropName[] = ["verifierAddress", "admin"];

  for (const name of directDownloadContracts) {
    const [currentValue, maybeProposed] = diff.hexAttrDiff(name);
    if (maybeProposed.isSome()) {
      const current = await env.l1Client().getSourceCode(currentValue);
      await current.writeSources(path.join(targetDir, "current", name.replace("Address", "")));

      const proposed = await env.l1Client().getSourceCode(maybeProposed.unwrap());
      await proposed.writeSources(path.join(targetDir, "proposed", name.replace("Address", "")));
    }
  }
}

export const downloadCodeCommand = async (
  env: EnvBuilder,
  upgradeDirectory: string,
  targetDir: string,
  _l1Filter: string[]
) => {
  const current = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, env.l1Client(), env.rpcL1()),
    "Gathering current zksync state",
    env
  );

  const importer = env.importer();
  const upgrade = await importer.readFromFiles(upgradeDirectory, env.network);

  const data = upgrade.upgradeCalldataHex.expect(
    new MalformedUpgrade("Missing calldata for governor operations")
  );

  const repo = await withSpinner(
    async () => {
      const repo = await env.contractsRepo();
      await repo.compileSystemContracts();
      return repo;
    },
    "Locally compiling system contracts",
    env
  );

  const [proposed, systemContractsAddrs] = await withSpinner(
    () =>
      ZksyncEraState.fromCalldata(
        Buffer.from(hexToBytes(data)),
        env.network,
        env.l1Client(),
        env.rpcL1(),
        env.l2Client()
      ),
    "Calculating upgrade changes",
    env
  );

  const diff = new ZkSyncEraDiff(current, proposed, systemContractsAddrs);

  await withSpinner(
    async () => downloadAllCode(diff, env, targetDir, repo),
    "Downloading all code",
    env
  );
  env.term().line(`🎉 All code successfully downloaded into ${targetDir}`)
};
