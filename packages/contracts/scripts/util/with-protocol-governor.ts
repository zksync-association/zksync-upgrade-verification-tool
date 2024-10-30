import { Contract, Provider, Wallet } from "zksync-ethers";
import hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import {
  GOVOPS_GOVERNOR_ADDRESS,
  PROTOCOL_GOVERNOR_ADDRESS,
  TOKEN_GOVERNOR_ADDRESS,
  type UpgradeData,
  ZK_TOKEN_ADDRESS,
} from "./constants.js";
import { type Address, type Hex, keccak256, numberToHex } from "viem";

type Callback = (contract: Contract, wallet: Wallet) => Promise<void>;

let singletonWallet: Wallet | undefined;
export function getZkWallet(): Wallet {
  if (singletonWallet !== undefined) {
    return singletonWallet;
  }

  const privateKey = process.env.PRIV_KEY;
  if (!privateKey) {
    throw new Error("Please provide a private key via PRIV_KEY env var.");
  }

  const provider = new Provider(hre.network.config.url, undefined, { cacheTimeout: -1 });
  const wallet = new Wallet(privateKey, provider);
  singletonWallet = wallet;
  return wallet;
}

export async function getContract(
  contractName: string,
  contractAddress: Address
): Promise<Contract> {
  const deployer = new Deployer(hre, getZkWallet());
  const artifact = await deployer.loadArtifact(contractName);
  return new Contract(contractAddress, artifact.abi, getZkWallet());
}

export async function getProtocolGovernor(): Promise<Contract> {
  return getContract("ZkProtocolGovernor", PROTOCOL_GOVERNOR_ADDRESS);
}

export async function getZkTokenContract(): Promise<Contract> {
  return getContract("ZkTokenV2", ZK_TOKEN_ADDRESS);
}

export async function getGovOpsGovernor(): Promise<Contract> {
  return getContract("ZkGovOpsGovernor", GOVOPS_GOVERNOR_ADDRESS);
}

export async function getTokenGovernor(): Promise<Contract> {
  return getContract("ZkTokenGovernor", TOKEN_GOVERNOR_ADDRESS);
}

export async function withProtocolGovernor(fn: Callback) {
  const zkWallet = getZkWallet();
  const contract = await getContract("ZkProtocolGovernor", PROTOCOL_GOVERNOR_ADDRESS);

  await fn(contract, zkWallet);
}

export async function calculateProposalId(contract: Contract, upgrade: UpgradeData): Promise<Hex> {
  const proposalIdBn = await contract
    .getFunction("hashProposal")
    .staticCall(
      upgrade.addresses,
      upgrade.values,
      upgrade.callDatas,
      keccak256(Buffer.from(upgrade.description))
    );
  return numberToHex(proposalIdBn);
}
