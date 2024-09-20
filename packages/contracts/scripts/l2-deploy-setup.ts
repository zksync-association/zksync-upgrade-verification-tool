import hre from "hardhat";
import { keccak256, zeroAddress } from "viem";
import { type Contract, type Wallet } from "zksync-ethers"
import type { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";

type SimpleDeployer = {
  loadArtifact: (name: string) => Promise<ZkSyncArtifact>,
  deploy: (artifact: ZkSyncArtifact, args: any[]) => Promise<Contract>;
}

async function deployAndPrepareZkToken(deployer: SimpleDeployer, zkWallet: Wallet): Promise<Contract> {
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

async function deployTokenGovernor(deployer: SimpleDeployer, tokenContract: Contract): Promise<Contract> {
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
    }
  ]);
  // Create a dummy token governor proposal. This is used to have realistic data in the webapp.
  const tokenGovProposalTx = await tokenGovContract.getFunction("propose").send(
    [zeroAddress],
    [0n],
    ["0x"],
    "Test Token proposal",
  );
  await tokenGovProposalTx.wait();
  return tokenGovContract
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
    }
  ]);
  // Create a dummy token gov ops proposal. This is used to have realistic data in the webapp.
  const govopsProposalTx = await govOpsGovContract.getFunction("propose").send(
    [zeroAddress, zeroAddress],
    [0n, 0n],
    ["0x", "0x"],
    "Test GovOps proposal",
  );
  await govopsProposalTx.wait();
  return govOpsGovContract
}

async function deployAndPrepareProtocolGovernor(deployer: SimpleDeployer, tokenContract: Contract, timeLockContract: Contract): Promise<Contract> {
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

  await hre.network.provider.send("hardhat_mine", ["0x100", "0x01"]);

  await protocolGovContract
    .getFunction("execute")
    .send(propAddresses, propValues, propCallDatas, keccak256(Buffer.from(description)));

  return protocolGovContract
}

async function main() {
  // Deployer is an object provided by zksync to deploy contracts:
  // https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-deploy#environment-extensions
  const deployer = hre.deployer;
  const zkWallet = await deployer.getWallet();

  const tokenContract = await deployAndPrepareZkToken(deployer, zkWallet);
  const timeLockContract = await deployTimelockContract(deployer, zkWallet);
  const tokenGovContract = await deployTokenGovernor(deployer, tokenContract);
  const govOpsGovernorContract = await deployGovOpsGovernor(deployer, tokenContract);
  const protocolGovContract = await deployAndPrepareProtocolGovernor(deployer, tokenContract, timeLockContract);

  console.log(`ZkToken: ${await tokenContract.getAddress()}`)
  console.log(`TimeLock: ${await timeLockContract.getAddress()}`)
  console.log(`TokenGovernor: ${await tokenGovContract.getAddress()}`)
  console.log(`GovOpsGovernor: ${await govOpsGovernorContract.getAddress()}`)
  console.log(`ProtocolGovernor: ${await protocolGovContract.getAddress()}`)
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
