import type { HardhatUserConfig } from "hardhat/config";

if (process.env.RICH_PRIVATE_KEY === undefined) {
  throw new Error("RICH_PRIVATE_KEY is required");
}

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: Number(process.env.CHAIN_ID),
      gas: "auto",
      accounts: [
        {
          privateKey: process.env.RICH_PRIVATE_KEY,
          balance: "10000000000000000000000",
        },
      ],
      mining: {
        auto: true,
      },
    },
  },
};

export default config;
