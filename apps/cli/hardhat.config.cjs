/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: Number(process.env.CHAIN_ID),
      accounts: [
        {
          privateKey: process.env.RICH_PRIVATE_KEY,
          balance: "10000000000000000000000",
        }
      ],
      mining: {
        auto: true
      }
    }
  }
};
