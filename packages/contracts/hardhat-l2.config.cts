import "@matterlabs/hardhat-zksync-node";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-ethers";
import { type HardhatUserConfig, subtask } from "hardhat/config.js";
import {
  TASK_COMPILE_SOLIDITY,
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
} from "hardhat/builtin-tasks/task-names.js";
import path from "node:path";
import { glob } from "glob";
import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

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

const ZK_GOV_PATH = path.join(__dirname, "src", "zk-gov-preprocessed");
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, hre) => {
  const l2Contracts = path.join(ZK_GOV_PATH, "l2-contracts", "src", "**", "*.sol");
  const devContracts = path.join(hre.config.paths.sources, "local-contracts", "**", "*.sol");
  return glob.sync([l2Contracts, devContracts]);
});

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  zksolc: { version: "latest" },
  paths: {
    sources: "src",
    cache: "cache",
    artifacts: "artifacts",
    tests: "tests",
  },
  networks: {
    local: {
      url: process.env.L2_RPC_URL || "http://localhost:8011",
      ethNetwork: process.env.L1_RPC_URL || "http://localhost:8545",
      zksync: true,
    },
    hardhat: {
      zksync: true,
    },
  },
};

export default config;
