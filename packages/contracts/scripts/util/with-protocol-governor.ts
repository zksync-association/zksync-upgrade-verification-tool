import { Contract, Provider, Wallet } from "zksync-ethers";
import hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { PROTOCOL_GOVERNOR_ADDRESS } from "./constants.js";
import type { Address } from "viem";

type Callback = (contract: Contract, wallet: Wallet) => Promise<void>

let singletonWallet: Wallet | undefined;
function getZkWallet(): Wallet {
  if (singletonWallet !== undefined) {
    return singletonWallet;
  }

  const privateKey = process.env.PRIV_KEY
  if (!privateKey) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  const provider = new Provider(hre.network.config.url, undefined, {cacheTimeout: -1});
  const wallet = new Wallet(privateKey, provider);
  singletonWallet = wallet;
  return wallet;
}

export async function getContract(contractName: string, contractAddress: Address): Promise<Contract> {
  const deployer = new Deployer(hre, getZkWallet());
  const artifact = await deployer.loadArtifact(contractName)
  return new Contract(contractAddress, artifact.abi, getZkWallet())
}

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