import "@nomicfoundation/hardhat-viem";
import { writeFile } from "node:fs/promises";
import {
  TASK_COMPILE_SOLIDITY,
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
} from "hardhat/builtin-tasks/task-names";
import type { HardhatUserConfig } from "hardhat/config";
import { subtask } from "hardhat/config";
import path from "node:path";
import Dotenv from "dotenv";
import { glob } from "glob";

Dotenv.config();

const ZK_GOV_PATH = path.join(__dirname, "contracts", "zk-gov-preprocessed");

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, hre) => {
  const l1Contracts = path.join(ZK_GOV_PATH, "l1-contracts", "src", "**", "*.sol");
  const l2Contracts = path.join(ZK_GOV_PATH, "l2-contracts", "src", "**", "*.sol");
  const devContracts = path.join(hre.config.paths.sources, "local-contracts", "**", "*.sol");
  const contractPaths = glob.sync([l1Contracts, l2Contracts, devContracts]);
  return contractPaths;
});

subtask(TASK_COMPILE_SOLIDITY).setAction(async (_, { config }, runSuper) => {
  const superRes = await runSuper();

  try {
    await writeFile(path.join(config.paths.artifacts, "package.json"), '{ "type": "commonjs" }');
  } catch (error) {
    console.error("Error writing package.json: ", error);
  }

  return superRes;
});

const forkUrl = process.env.FORK_URL;

if (!forkUrl) {
  throw new Error("Missing ENV_VAR FORK_URL");
}

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths: {
    sources: "contracts",
    cache: "cache",
    artifacts: "artifacts",
    tests: "suites/contracts",
  },
  networks: {
    remote: {
      url: process.env.L1_RPC_URL || "ENV_VAR_L1_RPC_URL_MISSING",
    },
    local: {
      url: "http://localhost:8545",
    },
    hardhat: {
      chainId: 11155111,
      mining: {
        auto: false,
        interval: 1000,
      },
      forking: {
        url: forkUrl,
      },
      accounts: {
        mnemonic: "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
      },
    },
  },
};

export default config;
