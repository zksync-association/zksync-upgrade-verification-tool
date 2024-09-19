import hre from "hardhat";
import "@matterlabs/hardhat-zksync-deploy";
import { keccak256, zeroAddress } from "viem";

async function main() {
  // hre.deployer.zksync = true
  const deployer = hre.deployer
  const zkWallet = await deployer.getWallet()


  console.log(await zkWallet.address);


  const tokenArtifact = await deployer.loadArtifact("ZkTokenV1");
  const tokenContract = await deployer.deploy(tokenArtifact, []);
  await tokenContract.waitForDeployment();
  // Initialize token contract
  const initializeZkTokenTx = await tokenContract.getFunction("initialize").send(zkWallet.address, zkWallet.address, 1000000000n);
  await initializeZkTokenTx.wait();
  const delegateVotesTx = await tokenContract.getFunction("delegate").send(zkWallet.address);
  await delegateVotesTx.wait();


  const timeLockArtifact = await deployer.loadArtifact("TimelockController");
  const timeLockContract = await deployer.deploy(timeLockArtifact, [0, [zkWallet.address], [zkWallet.address], zkWallet.address]);
  await timeLockContract.waitForDeployment();
  // Granting a role to address zero es equivalent to grant to everyone. Granting all permissions to everyone.
  const grant1 = await timeLockContract.getFunction("grantRole").send(keccak256(Buffer.from("PROPOSER_ROLE")), zeroAddress);
  const grant2 = await timeLockContract.getFunction("grantRole").send(keccak256(Buffer.from("EXECUTOR_ROLE")), zeroAddress);
  const grant3 = await timeLockContract.getFunction("grantRole").send(keccak256(Buffer.from("CANCELLER_ROLE")), zeroAddress);
  const grant4 = await timeLockContract.getFunction("grantRole").send(keccak256(Buffer.from("TIMELOCK_ADMIN_ROLE")), zeroAddress);
  await Promise.all([ grant1.wait(), grant2.wait(), grant3.wait(), grant4.wait() ])

  // Protocol Governor
  const protocolGovArtifact = await deployer.loadArtifact("ZkProtocolGovernor");
  const protocolGovContract = await deployer.deploy(protocolGovArtifact, [
    "ZkGovOpsGovernor",
    await tokenContract.getAddress(),
    await timeLockContract.getAddress(),
    0,
    100,
    1,
    1,
    1
  ]);
  await protocolGovContract.waitForDeployment();

  const propAddresses = [zeroAddress];
  const propValues = [0n];
  const propCallDatas = ["0x00"];
  const description = "Test protocol proposal";
  const proposeTx = await protocolGovContract.getFunction("propose").send(
    propAddresses,
    propValues,
    propCallDatas,
    description,
  );
  await proposeTx.wait();

  const proposalId = await protocolGovContract.getFunction("hashProposal").staticCall(
    propAddresses,
    propValues,
    propCallDatas,
    keccak256(Buffer.from(description)),
  );

  const castVoteTx = await protocolGovContract.getFunction("castVote").send(
    proposalId,
    1n
  );
  await castVoteTx.wait()

  // const lastBlock = await hre.network.provider.send("eth_getBlockByNumber", ["latest", true]);
  // const votes = await protocolGovContract.getFunction("getVotes").staticCall(zkWallet.address, lastBlock.number);
  // console.log(votes)

  await hre.network.provider.send("hardhat_mine", ["0x100", "0x01"]);

  await protocolGovContract.getFunction("execute").send(
    propAddresses,
    propValues,
    propCallDatas,
    keccak256(Buffer.from(description)),
  )

  // const deadline = await protocolGovContract.getFunction("proposalSnapshot").staticCall(proposalId)
  // console.log("deadline", deadline)
  //
  // const snapshoet = await protocolGovContract.getFunction("proposalSnapshot").staticCall(proposalId)
  // console.log("snapshoet", snapshoet)
  //
  // const state = await protocolGovContract.getFunction("state").staticCall(proposalId)
  // console.log("state", state)
  //
  // const votes = await tokenContract.getFunction("getPastVotes").staticCall(zkWallet.address, snapshoet);
  // console.log(votes)
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
