import hre from "hardhat";
import { Contract, Provider, Wallet } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import "dotenv/config"

// Workaround for the workaround proposed here: https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-node#running-hardhats-test-task-with-hardhat-zksync-node.
// The import to get the type it's not exposed. This is the part needed to make
// the typing work.
declare module "hardhat/types/config" {
  interface HardhatNetworkConfig {
    zksync: boolean;
    url: string;
  }
}

const ZK_TOKEN_ADDRESS = "0xfcd338217Fec145A3c8Dba9645cc2DaBD616B8E7";


async function main() {
  const privKey = process.env.PRIV_KEY

  if (!privKey) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  const provider = new Provider(hre.network.config.url, undefined, { cacheTimeout: -1 });
  const zkWallet = new Wallet(privKey, provider)
  const deployer = new Deployer(hre, zkWallet);
  const artifact = await deployer.loadArtifact("ZkTokenV2")

  const contract = new Contract(ZK_TOKEN_ADDRESS, artifact.abi, zkWallet)

  await contract.getFunction("delegate").send(zkWallet.address)
}

main()
  .then(() => {
    console.log("✅ delegate completed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ delegate tokens failed");
  });