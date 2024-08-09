import { type BrowserContext, test as baseTest } from "@playwright/test";
import dappwright, { type Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
export { expect } from "@playwright/test";

let sharedBrowserContext: BrowserContext;

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: <explanation>
  context: async ({}, use) => {
    if (!sharedBrowserContext) {
      // Launch context with extension
      const [wallet, page, browserContext] = await dappwright.bootstrap("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        seed: "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
        headless: false,
      });

      await wallet.addNetwork({
        networkName: "Hardhat",
        rpc: "http://localhost:8545",
        chainId: 11155111,
        symbol: "SepoliaETH",
      });

      // Navigate to the page and connect the wallet
      await page.goto("http://localhost:3000");
      await page.getByText("Connect Wallet").click();
      await page.getByText("Metamask").click();
      await wallet.approve();

      // Cache context
      sharedBrowserContext = browserContext;
    }
    await use(sharedBrowserContext);
  },

  wallet: async ({ context }, use) => {
    const metamask = await dappwright.getWallet("metamask", context);
    await use(metamask);
  },
});
