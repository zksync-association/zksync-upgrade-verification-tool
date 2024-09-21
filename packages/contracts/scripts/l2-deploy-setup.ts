import hre from "hardhat";
import { keccak256, zeroAddress } from "viem";
import { type Contract, Provider, type Wallet } from "zksync-ethers";
import type { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import fs from "node:fs/promises";

// Workaround for the workaround proposed here: https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-node#running-hardhats-test-task-with-hardhat-zksync-node.
// The import to get the type it's not exposed. This is the part needed to make
// the typing work.
declare module "hardhat/types/config" {
  interface HardhatNetworkConfig {
    zksync: boolean;
    url: string;
  }
}

type SimpleDeployer = {
  loadArtifact: (name: string) => Promise<ZkSyncArtifact>;
  deploy: (artifact: ZkSyncArtifact, args: any[]) => Promise<Contract>;
};

async function deployAndPrepareZkToken(
  deployer: SimpleDeployer,
  zkWallet: Wallet
): Promise<Contract> {
  const tokenArtifact = await deployer.loadArtifact("ZkTokenV1");
  const tokenContract: Contract = await deployer.deploy(tokenArtifact, []);
  await tokenContract.waitForDeployment();

  // Initialize token contract
  const initializeZkTokenTx = await tokenContract
    .getFunction("initialize")
    .send(zkWallet.address, zkWallet.address, 1000000000n);

  // Delegate votes to deployer address
  await initializeZkTokenTx.wait();
  const delegateVotesTx = await tokenContract.getFunction("delegate").send(zkWallet.address);
  await delegateVotesTx.wait();
  return tokenContract;
}

async function deployTimelockContract(deployer: SimpleDeployer, zkWallet: Wallet) {
  const timeLockArtifact = await deployer.loadArtifact("TimelockController");
  const timeLockContract = await deployer.deploy(timeLockArtifact, [
    0,
    [zkWallet.address],
    [zkWallet.address],
    zkWallet.address,
  ]);
  await timeLockContract.waitForDeployment();
  // Granting a role to address zero es equivalent to grant to everyone. Granting all permissions to everyone.
  const grant1 = await timeLockContract
    .getFunction("grantRole")
    .send(keccak256(Buffer.from("PROPOSER_ROLE")), zeroAddress);
  const grant2 = await timeLockContract
    .getFunction("grantRole")
    .send(keccak256(Buffer.from("EXECUTOR_ROLE")), zeroAddress);
  const grant3 = await timeLockContract
    .getFunction("grantRole")
    .send(keccak256(Buffer.from("CANCELLER_ROLE")), zeroAddress);
  const grant4 = await timeLockContract
    .getFunction("grantRole")
    .send(keccak256(Buffer.from("TIMELOCK_ADMIN_ROLE")), zeroAddress);
  await Promise.all([grant1.wait(), grant2.wait(), grant3.wait(), grant4.wait()]);
  return timeLockContract;
}

async function deployTokenGovernor(
  deployer: SimpleDeployer,
  tokenContract: Contract
): Promise<Contract> {
  const tokenGovArtifact = await deployer.loadArtifact("ZkTokenGovernor");
  const tokenGovContract = await deployer.deploy(tokenGovArtifact, [
    {
      name: "ZkTokenGovernor",
      token: await tokenContract.getAddress(),
      timelock: zeroAddress,
      initialVotingDelay: 0,
      initialVotingPeriod: 100000,
      initialProposalThreshold: 0,
      initialQuorum: 0,
      initialVoteExtension: 0,
      vetoGuardian: zeroAddress,
      proposeGuardian: zeroAddress,
      isProposeGuarded: false,
    },
  ]);
  // Create a dummy token governor proposal. This is used to have realistic data in the webapp.
  const tokenGovProposalTx = await tokenGovContract
    .getFunction("propose")
    .send([zeroAddress], [0n], ["0x"], "Test Token proposal");
  await tokenGovProposalTx.wait();
  return tokenGovContract;
}

async function deployGovOpsGovernor(deployer: SimpleDeployer, tokenContract: Contract) {
  const govOpsGovArtifact = await deployer.loadArtifact("ZkGovOpsGovernor");
  const govOpsGovContract = await deployer.deploy(govOpsGovArtifact, [
    {
      name: "ZkGovOpsGovernor",
      token: await tokenContract.getAddress(),
      timelock: zeroAddress,
      initialVotingDelay: 0,
      initialVotingPeriod: 100000,
      initialProposalThreshold: 0,
      initialQuorum: 0,
      initialVoteExtension: 0,
      vetoGuardian: zeroAddress,
      proposeGuardian: zeroAddress,
      isProposeGuarded: false,
    },
  ]);
  // Create a dummy token gov ops proposal. This is used to have realistic data in the webapp.
  const govopsProposalTx = await govOpsGovContract
    .getFunction("propose")
    .send([zeroAddress, zeroAddress], [0n, 0n], ["0x", "0x"], "Test GovOps proposal");
  await govopsProposalTx.wait();
  return govOpsGovContract;
}

async function deployAndPrepareProtocolGovernor(
  deployer: SimpleDeployer,
  tokenContract: Contract,
  timeLockContract: Contract,
  provider: Provider
): Promise<Contract> {
  const protocolGovArtifact = await deployer.loadArtifact("ZkProtocolGovernor");
  const protocolGovContract = await deployer.deploy(protocolGovArtifact, [
    "ZkGovOpsGovernor",
    await tokenContract.getAddress(),
    await timeLockContract.getAddress(),
    0,
    100,
    1,
    1,
    1,
  ]);
  await protocolGovContract.waitForDeployment();

  const propAddresses = [zeroAddress];
  const propValues = [0n];
  const propCallDatas = ["0x"];
  const description = "Test protocol proposal";
  const proposeTx = await protocolGovContract
    .getFunction("propose")
    .send(propAddresses, propValues, propCallDatas, description);
  await proposeTx.wait();

  const proposalId = await protocolGovContract
    .getFunction("hashProposal")
    .staticCall(propAddresses, propValues, propCallDatas, keccak256(Buffer.from(description)));

  const castVoteTx = await protocolGovContract.getFunction("castVote").send(proposalId, 1n);
  await castVoteTx.wait();

  await provider.send("hardhat_mine", ["0x100", "0x01"]);

  await protocolGovContract
    .getFunction("execute")
    .send(propAddresses, propValues, propCallDatas, keccak256(Buffer.from(description)));

  return protocolGovContract;
}

async function main() {
  // Deployer is an object provided by zksync to deploy contracts:
  // https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-deploy#environment-extensions
  const provider = new Provider(hre.network.config.url, undefined, { cacheTimeout: -1 });
  const zkWallet = await hre.zksyncEthers.getWallet(0).then((w) => w.connect(provider));
  const deployer = new Deployer(hre, zkWallet);

  const tokenContract = await deployAndPrepareZkToken(deployer, zkWallet);
  const timeLockContract = await deployTimelockContract(deployer, zkWallet);
  const tokenGovContract = await deployTokenGovernor(deployer, tokenContract);
  const govOpsGovernorContract = await deployGovOpsGovernor(deployer, tokenContract);
  const protocolGovContract = await deployAndPrepareProtocolGovernor(
    deployer,
    tokenContract,
    timeLockContract,
    provider
  );

  const text = [
    `ZkToken: ${await tokenContract.getAddress()}`,
    `ZkToken: ${await tokenContract.getAddress()}`,
    `TimeLock: ${await timeLockContract.getAddress()}`,
    `TokenGovernor: ${await tokenGovContract.getAddress()}`,
    `GovOpsGovernor: ${await govOpsGovernorContract.getAddress()}`,
    `ProtocolGovernor: ${await protocolGovContract.getAddress()}`,
    "",
  ].join("\n");

  console.log(text);
  await fs.writeFile("addresses-l2.txt", text);
}

main()
  .then(() => {
    console.log("✅ Deploy:Setup completed");
  })

  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ Deploy:Setup failed");
  });
