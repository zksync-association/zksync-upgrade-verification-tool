import hre from "hardhat";
import { Contract, Provider, Wallet } from "zksync-ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import "dotenv/config"
import { bytesToHex, encodeFunctionData, keccak256, numberToHex } from "viem";
import { randomBytes } from "node:crypto";
import { withProtocolGovernor } from "./util/with-protocol-governor";

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
  const proposalId = process.env.PROPOSAL_ID

  if (!proposalId) {
    throw new Error("Please provide a private key via PRIV_KEY env var.")
  }

  await withProtocolGovernor(async (contract, wallet) => {
    const castVoteTx = await contract.getFunction("castVote").send(proposalId, 1n);
    await castVoteTx.wait();

    console.log("Voted OK");
  })
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    console.log("❌ failed");
  });