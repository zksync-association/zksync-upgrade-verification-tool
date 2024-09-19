import hre from "hardhat";
// import "@matterlabs/hardhat-zksync-deploy";

async function main() {
  const deployer = hre.deployer
  const wallet = await deployer.getWallet()


  const tokenArtifact = await deployer.loadArtifact("ZkTokenV1");
  const tokenContract = await deployer.deploy(tokenArtifact, []);
  await tokenContract.waitForDeployment();
  console.log(tokenArtifact.abi)
  const initializeTx = await tokenContract.getFunction("initialize").send([wallet.address, wallet.address, 10000000n])
  await initializeTx.wait();

  console.log("wallet", wallet)
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
