import { getAddress, stringToHex, isAddress, publicActions, type Hash } from "viem";
import hre from "hardhat";

async function main() {
  const signer = (await hre.viem.getWalletClients())[0];
  signer.extend(publicActions);

  const handlerAddress = process.env.HANDLER_ADDRESS;

  if (!handlerAddress) {
    throw new Error("HANDLER_ADDRESS environment variable not set");
  }

  if (!isAddress(handlerAddress)) {
    console.error("Error: Invalid handler address provided.");
    console.log(
      "Please provide a valid Ethereum address starting with '0x' and 40 hexadecimal characters."
    );
    process.exit(1);
  }

  const handler = await hre.viem.getContractAt("IProtocolUpgradeHandler", handlerAddress);

  const calls = [
    {
      target: getAddress("0x32400084C286CF3E17e7B677ea9583e60a000324"),
      value: 0n,
      data: stringToHex("a9f"),
    },
  ];

  const proposal = {
    calls: calls,
    executor: "0x01" as Hash,
    salt: "0x" as Hash,
  };

  const tx = await handler.write.startUpgrade([0n, 0n, 0, [], proposal], {
    account: signer.account,
  });

  const client = await hre.viem.getPublicClient();
  await client.waitForTransactionReceipt({ hash: tx });
  console.log("Upgrade started successfully");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
