import hre from "hardhat";
import { Contract, Provider, Wallet } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import "dotenv/config"
import { bytesToHex, encodeFunctionData, keccak256, numberToHex } from "viem";
import { randomBytes } from "node:crypto";

// Workaround for the workaround proposed here: https://docs.zksync.io/build/tooling/hardhat/plugins/hardhat-zksync-node#running-hardhats-test-task-with-hardhat-zksync-node.
// The import to get the type it's not exposed. This is the part needed to make
// the typing work.
declare module "hardhat/types/config" {
  interface HardhatNetworkConfig {
    zksync: boolean;
    url: string;
  }
}

const PROTOCOL_GOVERNOR_ADDRESS = "0x08c18e8359C3c6aA600A3726BA6dCC100e222021";

async function main() {
  const privateKey = process.env.PRIV_KEY
  const proposalId = process.env.PROPOSAL_ID

  if (!privateKey || !proposalId) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  const provider = new Provider(hre.network.config.url, undefined, { cacheTimeout: -1 });
  const zkWallet = new Wallet(privateKey, provider)
  const deployer = new Deployer(hre, zkWallet);
  const artifact = await deployer.loadArtifact("ZkProtocolGovernor")

  const contract = new Contract(PROTOCOL_GOVERNOR_ADDRESS, artifact.abi, zkWallet)

  const calldata = encodeFunctionData({
    abi: [
      {
        inputs: [
          {
            internalType: "bytes",
            name: "_message",
            type: "bytes",
          },
        ],
        name: "sendToL1",
        outputs: [
          {
            internalType: "bytes32",
            name: "hash",
            type: "bytes32",
          },
        ],
        stateMutability: "nonpayable",
        type: "function",
      },
    ],
    functionName: "sendToL1",
    args: [
      "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000358baca94dcd7931b7ba7aaf8a5ac6090e143a500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000004499a88ec400000000000000000000000035a54c8c757806eb6820629bc82d90e056394c92000000000000000000000000cb4c8d1ecdca0e256a7341c4487938cfaaed432200000000000000000000000000000000000000000000000000000000",
    ],
  });

  const propAddresses = ["0x0000000000000000000000000000000000008008"];
  const propValues = [0n];
  const propCallDatas = [calldata];
  const description = `Test protocol proposal 01`;

  const executeTx = await contract
    .getFunction("execute")
    .send(propAddresses, propValues, propCallDatas, keccak256(Buffer.from(description)));
  await executeTx.wait();

  console.log("Executed OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ failed");
  });