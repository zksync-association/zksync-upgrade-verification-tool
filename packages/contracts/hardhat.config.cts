import "@nomicfoundation/hardhat-viem";
import { writeFile } from "node:fs/promises";
import {
  TASK_COMPILE_SOLIDITY,
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
} from "hardhat/builtin-tasks/task-names.js";
import type { HardhatUserConfig } from "hardhat/config.js";
import { subtask } from "hardhat/config.js";
import path from "node:path";
import Dotenv from "dotenv";
import { glob } from "glob";
import { execSync } from "node:child_process";

Dotenv.config();

const ZK_GOV_PATH = path.join(__dirname, "src", "zk-gov-preprocessed");

subtask(TASK_COMPILE_SOLIDITY).setAction(async (_, { config }, runSuper) => {
  // Preprocess zkGov contracts
  execSync("npm run preprocess:zk-gov", { stdio: "inherit" });

  const superRes = await runSuper();

  try {
    await writeFile(path.join(config.paths.artifacts, "package.json"), '{ "type": "commonjs" }');
  } catch (error) {
    console.error("Error writing package.json: ", error);
  }

  return superRes;
});

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, hre) => {
  const l1Contracts = path.join(ZK_GOV_PATH, "l1-contracts", "src", "**", "*.sol");
  const l2Contracts = path.join(ZK_GOV_PATH, "l2-contracts", "src", "**", "*.sol");
  const devContracts = path.join(hre.config.paths.sources, "local-contracts", "**", "*.sol");
  return glob.sync([l1Contracts, l2Contracts, devContracts]);
});

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths: {
    sources: "src",
    cache: "cache",
    artifacts: "artifacts",
    tests: "tests",
  },
  networks: {
    remote: {
      chainId: 11155111,
      url: process.env.L1_RPC_URL || "ENV_VAR_L1_RPC_URL_MISSING",
    },
    local: {
      chainId: 11155111,
      url: process.env.L1_RPC_URL || "http://localhost:8545",
      allowUnlimitedContractSize: true,
    },
    hardhat: {
      chainId: 11155111,
      allowUnlimitedContractSize: true,
      mining: {
        auto: true,
        interval: 1000,
      },
      forking: {
        enabled: !!process.env.FORK_URL,
        url: process.env.FORK_URL || "ENV_VAR_FORK_URL_MISSING",
      },
      accounts: {
        mnemonic:
          process.env.MNEMONIC ||
          "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
      },
    },
  },
};

export default config;
