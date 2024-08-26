import { type BrowserContext, type Page, test as baseTest } from "@playwright/test";
import dappwright, { type Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
import "dotenv/config";
import {
  ALL_COUNCIL_INDEXES,
  ALL_GUARDIAN_INDEXES,
} from "./constants.js";

export { expect } from "@playwright/test";

let sharedBrowserContext: BrowserContext;

export class RoleSwitcher {
  private wallet: Dappwright;

  constructor(wallet: Dappwright) {
    this.wallet = wallet;
  }

  private async changeToMember(indexes: number[], memberNumber: number, groupName: string, page: Page) {
    const selectedCouncil = indexes[memberNumber];
    if (selectedCouncil === undefined) {
      throw new Error(
        `There is only ${indexes.length} ${groupName} members. Received: ${memberNumber}`
      );
    }
    await this.switchToIndex(selectedCouncil, page);
    await page.bringToFront();
    await page.reload();
  }

  async council(page: Page, councilNumber = 0): Promise<void> {
    await this.changeToMember(ALL_COUNCIL_INDEXES, councilNumber, "security council", page)
  }

  async guardian(page: Page, guardianNumber = 0): Promise<void> {
    await this.changeToMember(ALL_GUARDIAN_INDEXES, guardianNumber, "guardians", page)
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
