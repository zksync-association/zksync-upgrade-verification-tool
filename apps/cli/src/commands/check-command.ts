import type { EnvBuilder } from "../lib/env-builder.js";
import { hexToBytes } from "viem";
import { withSpinner } from "../lib/with-spinner.js";
import { ZksyncEraState } from "../reports/zksync-era-state";
import { ZkSyncEraDiff } from "../reports/zk-sync-era-diff";
import { DIAMOND_ADDRS } from "@repo/common/ethereum";
import { UpgradeFile } from "../lib/upgrade-file";
import { StringCheckReport } from "../reports/reports/string-check-report";
import { Diamond } from "../reports/diamond";
import { LocalFork } from "../reports/local-fork";

export async function checkCommand(env: EnvBuilder, upgradeFilePath: string) {
  const repo = await withSpinner(
    async () => {
      // const repo = await env.contractsRepo();
      // await repo.compileSystemContracts();
      // return repo;
      return await env.contractsRepo();
    },
    "Locally compiling system contracts",
    env
  );

  const file = UpgradeFile.fromFile(upgradeFilePath)

  const diamondaddr = DIAMOND_ADDRS[env.network];
  const diamond = await Diamond.create(diamondaddr, env.l1Client(), env.rpcL1())

  const current = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, env.rpcL1(), diamond),
    "Gathering current zksync state",
    env
  );

  const localFork = await LocalFork.create(env.rpcL1().rpcUrl(), env.network)
  const forkRpc = localFork.rpc()

  const transitionManager = await diamond.getTransitionManager(env.rpcL1(), env.l1Client())
  const protocolHandlerAddress = await transitionManager.upgradeHandlerAddress(env.rpcL1())


  for (const call of file.calls) {
    const [_, debugInfo] =  await localFork.execDebugTx(protocolHandlerAddress, call.target, call.data, call.value)
    const selector = diamond.selectorFor("executeUpgrade").unwrap()
    const coso = debugInfo.find(di => di.input.startsWith(selector))
    console.log(coso)
  }

  const finalDiamond = await Diamond.create(diamondaddr, env.l1Client(), forkRpc)
  const proposed = await withSpinner(
    async () => ZksyncEraState.fromBlockchain(env.network, forkRpc, finalDiamond),
    "Gathering current zksync state",
    env
  );

  const diff = new ZkSyncEraDiff(current, proposed, []);

  const report = new StringCheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
  await localFork.tearDown();
}


export async function checkCommandOld(env: EnvBuilder, upgradeFilePath: string) {
  const dataHex = UpgradeFile.fromFile(upgradeFilePath)
    .firstCallData()
    .expect(new Error("Missing calldata"));

  const current = await withSpinner(
    async () => {
      const diamond1 = await Diamond.create(DIAMOND_ADDRS[env.network], env.l1Client(), env.rpcL1());
      return ZksyncEraState.fromBlockchain(env.network, env.rpcL1(), diamond1)
    },
    "Gathering current zksync state",
    env
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

  const stateManagerAddress = current
    .hexAttrValue("stateTransitionManagerAddress")
    .expect(new Error("Should be present"));

  const [proposed, systemContractsAddrs] = await withSpinner(
    () =>
      ZksyncEraState.fromCalldata(
        "0x8f7a9912416e8AdC4D9c21FAe1415D3318A11897",
        stateManagerAddress,  //DIAMOND_ADDRS[env.network],
        Buffer.from(hexToBytes(dataHex)),
        env.network,
        env.l1Client(),
        env.rpcL1(),
        env.l2Client()
      ),
    "Calculating upgrade changes",
    env
  );

  const diff = new ZkSyncEraDiff(current, proposed, systemContractsAddrs);

  const report = new StringCheckReport(diff, repo, env.l1Client());
  env.term().line(await report.format());
}
