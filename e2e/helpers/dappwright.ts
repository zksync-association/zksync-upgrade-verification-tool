import { type BrowserContext, test as baseTest } from "@playwright/test";
import dappwright, { type Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
export { expect } from "@playwright/test";

const PRIVATE_KEY = "d8ead60e7122c6a97f9f03c08f4cdfb9d67ce4b893b4341cd48e73316aed9022";

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: <explanation>
  context: async ({}, use) => {
    // Launch context with extension
    const [wallet, _, context] = await dappwright.bootstrap("", {
      wallet: "metamask",
      version: MetaMaskWallet.recommendedVersion,
      // seed: "suspect naive grow benefit turkey pizza fine luxury young bullet noise barely flee cement venture",
      seed: "test test test test test test test test test test test junk",
      headless: false,
    });

    await wallet.importPK(PRIVATE_KEY);

    // Add Local Hardhat as a custom network
    await wallet.addNetwork({
      networkName: "Hardhat",
      rpc: "http://localhost:8545",
      chainId: 31337,
      symbol: "SepoliaETH",
    });

    await use(context);
  },

  wallet: async ({ context }, use) => {
    const metamask = await dappwright.getWallet("metamask", context);

    await use(metamask);
  },
});
