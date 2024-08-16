import "@nomicfoundation/hardhat-viem";
import { writeFile } from "fs/promises";
import { TASK_COMPILE_SOLIDITY, TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";
import type { HardhatUserConfig } from "hardhat/config";
import { subtask } from "hardhat/config";
import { join } from "path";
import Dotenv from "dotenv";
const glob = require('glob')
import path from "path";
Dotenv.config()

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, hre, runSuper) => {
  const paths = await runSuper();

  const l1contracts = path.join(hre.config.paths.sources, "zk-gov","l1-contracts","src", "**", "*.sol");
  // const l2contracts = path.join(hre.config.paths.sources, "zk-gov","l2-contracts","src", "**", "*.sol");
  const devcontracts = path.join(hre.config.paths.sources, "local-contracts", "**", "*.sol");
  const otherPaths = glob.sync([l1contracts, devcontracts]);
  return [...otherPaths];
});

subtask(TASK_COMPILE_SOLIDITY).setAction(async (_, { config }, runSuper) => {
  const superRes = await runSuper();

  try {
    await writeFile(
      join(config.paths.artifacts, "package.json"),
      '{ "type": "commonjs" }'
    );
  } catch (error) {
    console.error("Error writing package.json: ", error);
  }

  return superRes;
});

const forkUrl = process.env.FORK_URL

if (!forkUrl) {
  throw new Error("Missing ENV_VAR FORK_URL")
}

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths:{
    sources:"contracts",
        cache: "cache",
    artifacts: "artifacts",
    tests:"suites/contracts"
  },
  networks: {
    remote:{
      url: process.env.L1_RPC_URL || "ENV_VAR_L1_RPC_URL_MISSING"
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
        mnemonic:
          "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
      },
    },
  },
};

export default config;