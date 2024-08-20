import { type BrowserContext, type Page, test as baseTest } from "@playwright/test";
import dappwright, { type Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
import "dotenv/config";

export { expect } from "@playwright/test";

let sharedBrowserContext: BrowserContext;

export class RoleSwitcher {
  private wallet: Dappwright;

  constructor(wallet: Dappwright) {
    this.wallet = wallet;
  }

  async council(page: Page, councilNumber = 0): Promise<void> {
    const councilIndexes = [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

    if (councilNumber >= councilIndexes.length) {
      throw new Error(
        `There is only ${councilIndexes.length} security council members. Received: ${councilNumber}`
      );
    }
    await this.switchToIndex(councilIndexes[councilNumber], page);
    await page.bringToFront();
    await page.reload();
  }

  async guardian(page: Page, guardianNumber = 0): Promise<void> {
    const guardianIndexes = [2, 17, 18, 19, 20, 21, 22, 23, 24];

    if (guardianNumber >= guardianIndexes.length) {
      throw new Error(
        `There is only ${guardianIndexes.length} security council members. Received: ${guardianIndexes}`
      );
    }
    await this.switchToIndex(guardianIndexes[guardianNumber], page);
    await page.bringToFront();
  }

  async zkFoundation(page: Page): Promise<void> {
    await this.switchToIndex(3, page);
  }

  async visitor(page: Page): Promise<void> {
    await this.switchToIndex(4, page);
  }

  private async switchToIndex(index: number, page: Page) {
    let i = await this.countAccounts();
    while (i < index) {
      await this.wallet.createAccount();
      i += 1;
    }

    await this.wallet.switchAccount(index);
    await page.bringToFront();
  }

  private async countAccounts(): Promise<number> {
    const walletPage = this.wallet.page;
    await walletPage.bringToFront();
    await walletPage.getByTestId("account-menu-icon").click();
    const elems = await walletPage
      .getByRole("dialog")
      .getByRole("button", { name: /Account \d+/ })
      .all();

    const labels = await Promise.all(elems.map(async (elem) => await elem.textContent()));

    await walletPage.getByRole("button", { name: "Close" }).click();
    await walletPage.getByTestId("app-header-logo").first().click();

    return labels
      .filter((maybeLabel) => maybeLabel !== null)
      .filter((label) => /Account \d+/.test(label)).length;
  }
}

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
  switcher: RoleSwitcher;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: <explanation>
  context: async ({}, use) => {
    if (!sharedBrowserContext) {
      // Launch context with extension
      const [wallet, _page, browserContext] = await dappwright.bootstrap("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        seed:
          process.env.MNEMONIC ||
          "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
        headless: false,
      });

      await wallet.addNetwork({
        networkName: "Hardhat",
        rpc: "http://localhost:8545",
        chainId: 11155111,
        symbol: "SepoliaETH",
      });

      // 1 - council
      // 2 - guardian
      // 3 - zk association
      // 4 - visitor
      // TODO: speedup this.
      await wallet.createAccount();
      await wallet.createAccount();
      await wallet.createAccount();

      // Default to security council
      await wallet.switchAccount(1);

      // Navigate to the page and connect the wallet
      const newPage = await browserContext.newPage();
      await newPage.goto("http://localhost:3000");
      await newPage.getByText("Connect Wallet").click();
      await newPage.getByText("Metamask").click();
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

  switcher: async ({ wallet }, use) => {
    await use(new RoleSwitcher(wallet));
  },
});
