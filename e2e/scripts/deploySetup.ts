import hre from "hardhat";
import {
  encodeFunctionData,
  getAddress,
  type Hex,
  hexToBigInt,
  padHex,
  parseEther,
  zeroAddress,
} from "viem";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import { mnemonicToAccount } from "viem/accounts";
import {
  ALL_COUNCIL_INDEXES,
  ALL_GUARDIAN_INDEXES,
  DERIVATION_INDEXES,
} from "../helpers/constants.js";

dotenv.config();

async function main() {
  const walletClient = (await hre.viem.getWalletClients())[0];
  if (!walletClient) {
    throw new Error("Wallet client not found");
  }

  const {
    address: handlerAddress,
    write: writeHandler,
    abi: handlerAbi,
  } = await hre.viem.deployContract("ProtocolUpgradeHandler", [
    zeroAddress,
    zeroAddress,
    zeroAddress,
    zeroAddress,
    zeroAddress,
    zeroAddress,
    zeroAddress,
    zeroAddress,
  ]);

  console.log("ProtocolUpgradeHandler deployed to:", handlerAddress);

  // Transfer gas money to handler
  await walletClient.sendTransaction({
    to: handlerAddress,
    value: parseEther("1"),
  });

  const {
    guardians: guardianAddresses,
    council: scAddresses,
    zkAssociation: zkFoundationAddress,
  } = deriveAllAddresses();

  const { address: guardianAddress } = await hre.viem.deployContract("Guardians", [
    handlerAddress,
    "0x0000000000000000000000000000000000000008",
    guardianAddresses,
  ]);
  console.log("Guardians deployed to:", guardianAddress);

  const { address: securityCouncilAddress } = await hre.viem.deployContract("SecurityCouncil", [
    handlerAddress,
    scAddresses,
  ]);
  console.log("SecurityCouncil deployed to:", securityCouncilAddress);
  const { address: emergencyBoardAddress } = await hre.viem.deployContract(
    "EmergencyUpgradeBoard",
    [handlerAddress, securityCouncilAddress, guardianAddress, zkFoundationAddress]
  );
  console.log("EmergencyBoard deployed to:", emergencyBoardAddress);

  // In order to associate the multisigs with the protocol upgrade handler, we need to impersonate
  // the main account, because those methods can only be executed by itself.
  const testClient = await hre.viem.getTestClient();
  await testClient.impersonateAccount({ address: handlerAddress });
  const [handlerSigner] = await hre.viem.getWalletClients({
    account: handlerAddress,
  });
  await handlerSigner.writeContract({
    address: handlerAddress,
    functionName: "updateGuardians",
    args: [guardianAddress],
    abi: handlerAbi,
  });
  await handlerSigner.writeContract({
    address: handlerAddress,
    functionName: "updateSecurityCouncil",
    args: [securityCouncilAddress],
    abi: handlerAbi,
  });
  await handlerSigner.writeContract({
    address: handlerAddress,
    functionName: "updateEmergencyUpgradeBoard",
    args: [emergencyBoardAddress],
    abi: handlerAbi,
  });
  await testClient.stopImpersonatingAccount({ address: handlerAddress });

  const { address: counterAddress, abi: counterAbi } = await hre.viem.deployContract(
    "contracts/local-contracts/dev/Counter.sol:Counter",
    []
  );
  console.log("Counter deployed to:", counterAddress);

  await writeHandler.startUpgrade([
    0n,
    0n,
    0,
    [],
    {
      calls: [],
      executor: zeroAddress,
      salt: padHex("0x0"),
    },
  ]);
  const client = await hre.viem.getPublicClient();
  const chainId = await client.getChainId();

  let addressesContent = `ChainId:${chainId}\n`;
  addressesContent += `ProtocolUpgradeHandler: ${handlerAddress}\n`;
  addressesContent += `Guardians: ${guardianAddress}\n`;
  addressesContent += `SecurityCouncil: ${securityCouncilAddress}\n`;
  addressesContent += `Counter: ${counterAddress}\n`;
  addressesContent += `EmergencyUpgradeBoard: ${emergencyBoardAddress}\n`;

  // Deploy L2 contracts
  const zkToken = await hre.viem.deployContract("ZkTokenV1");
  await zkToken.write.initialize([handlerAddress, handlerAddress, 1000000000n]);

  const zkGovOpsGovernor = await hre.viem.deployContract("ZkGovOpsGovernor", [
    {
      name: "ZkGovOpsGovernor",
      token: zkToken.address,
      timelock: zeroAddress,
      initialVotingDelay: 0,
      initialVotingPeriod: 10000,
      initialProposalThreshold: 0,
      initialQuorum: 0,
      initialVoteExtension: 0,
      vetoGuardian: zeroAddress,
    },
  ]);
  console.log("ZkGovOpsGovernor deployed to:", zkGovOpsGovernor.address);

  const zkTokenGovernor = await hre.viem.deployContract("ZkTokenGovernor", [
    {
      name: "ZkTokenGovernor",
      token: zkToken.address,
      timelock: zeroAddress,
      initialVotingDelay: 0,
      initialVotingPeriod: 100,
      initialProposalThreshold: 0,
      initialQuorum: 0,
      initialVoteExtension: 0,
      vetoGuardian: zeroAddress,
      proposeGuardian: zeroAddress,
      isProposeGuarded: false,
    },
  ]);
  console.log("ZkTokenGovernor deployed to:", zkTokenGovernor.address);

  await zkGovOpsGovernor.write.propose([[zeroAddress], [0n], ["0x"], "Test GovOps proposal"]);
  await zkTokenGovernor.write.propose([[zeroAddress], [1n], ["0x"], "Test Token proposal"]);

  addressesContent += `ZkGovOpsGovernor: ${zkGovOpsGovernor.address}\n`;
  addressesContent += `ZkTokenGovernor: ${zkTokenGovernor.address}\n`;

  const calldata = encodeFunctionData({
    abi: counterAbi,
    functionName: "setNumber",
    args: [12n],
  });
  // It's useful to have a calldata at hand that does something easy to check to verify upgrade execution.
  addressesContent += `\nRealistic calldata: ${calldata}\n`;

  await fs.writeFile("addresses.txt", addressesContent);
  console.log("Addresses saved to addresses.txt");
}

function deriveMembers(extrasEnvVar: string, indexes: number[], mnemonic: string): Hex[] {
  // In case special addresses want to be used, these can be defined in env vars.
  const extras = (process.env[extrasEnvVar] || "")
    .split(",")
    .filter((str) => str.length !== 0)
    .map((str) => str.trim()) as Hex[];

  // Derive all addresses from mnemonic
  const derived = indexes
    .map((n) => mnemonicToAccount(mnemonic, { addressIndex: n }))
    .map((hd) => hd.address);

  // Addresses from env var take priority, but only the right amount of addresses is kept.
  const final = [...extras, ...derived].slice(0, indexes.length);

  // Contract require addresses to be sorted.
  return final.sort((a, b) => Number(hexToBigInt(a) - hexToBigInt(b)));
}

function deriveAllAddresses() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    throw new Error("Missing MNEMONIC env var");
  }

  const zkAssociation = mnemonicToAccount(mnemonic, {
    addressIndex: DERIVATION_INDEXES.ZK_FOUNDATION,
  }).address;
  const visitor = mnemonicToAccount(mnemonic, { addressIndex: DERIVATION_INDEXES.VISITOR }).address;

  return {
    council: deriveMembers("EXTRA_COUNCIL", ALL_COUNCIL_INDEXES, mnemonic),
    guardians: deriveMembers("EXTRA_GUARDIANS", ALL_GUARDIAN_INDEXES, mnemonic),
    zkAssociation: process.env.EXTRA_ZK_FOUNDATION
      ? getAddress(process.env.EXTRA_ZK_FOUNDATION)
      : zkAssociation,
    visitor: visitor,
  };
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
