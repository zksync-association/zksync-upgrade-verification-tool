import { Contract, Provider, Wallet } from "zksync-ethers";
import hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { PROTOCOL_GOVERNOR_ADDRESS } from "./constants.js";

type Callback = (contract: Contract, wallet: Wallet) => Promise<void>

export async function withProtocolGovernor(fn: Callback) {
  const privateKey = process.env.PRIV_KEY

  if (!privateKey) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  const provider = new Provider(hre.network.config.url, undefined, {cacheTimeout: -1});
  const zkWallet = new Wallet(privateKey, provider)
  const deployer = new Deployer(hre, zkWallet);
  const artifact = await deployer.loadArtifact("ZkProtocolGovernor")

  const contract = new Contract(PROTOCOL_GOVERNOR_ADDRESS, artifact.abi, zkWallet)

  await fn(contract, zkWallet)
}