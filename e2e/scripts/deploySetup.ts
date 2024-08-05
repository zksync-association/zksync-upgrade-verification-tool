import hre from "hardhat";
import { type Address, isAddress, padHex, parseEther, zeroAddress } from "viem";
import dotenv from "dotenv";
import fs from "node:fs/promises";
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

  const guardianAddresses = getAddresses("guardian");
  const { address: guardianAddress } = await hre.viem.deployContract("Guardians", [
    handlerAddress,
    "0x0000000000000000000000000000000000000008",
    guardianAddresses,
  ]);
  console.log("Guardians deployed to:", guardianAddress);

  const scAddresses = getAddresses("security-council");
  const { address: securityCouncilAddress } = await hre.viem.deployContract("SecurityCouncil", [
    handlerAddress,
    scAddresses,
  ]);
  console.log("SecurityCouncil deployed to:", securityCouncilAddress);

  const zkFoundationAddress = getZkFoundationAddress();
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

  const { address: counterAddress } = await hre.viem.deployContract("Counter", []);
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

  await fs.writeFile("addresses.txt", addressesContent);
  console.log("Addresses saved to addresses.txt");
}

function fetchAddrFromEnv(name: string): Address {
  const address = process.env[name];
  if (!address) {
    throw new Error(`Env variable ${name} expected to be defined but it's not`);
  }

  if (isAddress(address)) {
    return address;
  }
  throw new Error(`Found: ${address} inside process.env.${name}. Expected address`);
}

function getAddresses(type: "security-council" | "guardian"): Address[] {
  const prefix = type === "security-council" ? "SC_ADDR_" : "GUARDIAN_ADDR_";
  const maxAddresses = type === "security-council" ? 12 : 8;
  const addresses: Address[] = [];

  for (let i = 1; i <= maxAddresses; i++) {
    const envKey = `${prefix}${i}`;
    const address = fetchAddrFromEnv(envKey);
    addresses.push(address as Address);
  }

  if (addresses.length === 0) {
    throw new Error(`No valid addresses found for ${type}`);
  }

  return addresses;
}

function getZkFoundationAddress(): Address {
  return fetchAddrFromEnv("ZK_FOUNDATION_ADDRESS");
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
