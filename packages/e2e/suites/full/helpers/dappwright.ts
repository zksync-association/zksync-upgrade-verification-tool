import { type BrowserContext, type Page, test as baseTest } from "@playwright/test";
import dappwright, { type Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
import "dotenv/config";
import {
  COUNCIL_INDEXES,
  type COUNCIL_SIZE,
  DERIVATION_INDEXES,
  GUARDIAN_INDEXES,
  type GUARDIANS_SIZE,
} from "@repo/contracts/helpers/constants";
import { TestApp } from "./test-app.js";

export { expect } from "@playwright/test";

type Enumerate<N extends number, Acc extends number[] = []> = Acc["length"] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc["length"]]>;

/** IntRange is a type that represents a range of numbers from F to T inclusive */
export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>> | T;

let sharedBrowserContext: BrowserContext;

// Fast mode limits the number of accounts created to 1 per role
const fastMode = process.env.TEST_FAST_MODE === "true";

type ChangeAccountFn = () => Promise<void>;

export class RoleSwitcher {
  private wallet: Dappwright;
  private history: ChangeAccountFn[];
  private current: ChangeAccountFn | null;

  constructor(wallet: Dappwright) {
    this.wallet = wallet;
    this.history = [];
    this.current = null;
  }

  async council(councilNumber: IntRange<1, typeof COUNCIL_SIZE>, page?: Page) {
    if (fastMode && councilNumber !== 1) {
      throw new Error("Fast mode does not support council numbers other than 1");
    }
    const index = COUNCIL_INDEXES[councilNumber - 1] as number;
    this.current = async () => this.council(councilNumber);
    await this.switchToIndex(index, page);
  }

  async guardian(guardianNumber: IntRange<1, typeof GUARDIANS_SIZE>, page?: Page) {
    if (fastMode && guardianNumber !== 1) {
      throw new Error("Fast mode does not support guardian numbers other than 1");
    }
    const index = GUARDIAN_INDEXES[guardianNumber - 1] as number;
    this.current = async () => this.guardian(guardianNumber);
    await this.switchToIndex(index, page);
  }

  async zkFoundation(page?: Page) {
    this.current = async () => this.zkFoundation();
    await this.switchToIndex(DERIVATION_INDEXES.ZK_FOUNDATION, page);
  }

  async visitor(page?: Page) {
    this.current = async () => this.visitor();
    await this.switchToIndex(DERIVATION_INDEXES.VISITOR, page);
  }

  pushToHistory(): void {
    if (this.current === null) {
      throw new Error("Cannot push to history if no account is set.");
    }
    this.history.push(this.current);
  }

  popHistory(): ChangeAccountFn[] {
    const res = this.history;
    this.history = [];
    return res;
  }

  private async switchToIndex(index: number, page?: Page) {
    // Accounts in metamask are 1 indexed
    await this.wallet.switchAccount(index + 1);
    await page?.bringToFront();
  }
}

const testApp = new TestApp();

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
  switcher: RoleSwitcher;
  testApp: TestApp;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: <explanation>
  context: async ({}, use) => {
    if (!sharedBrowserContext) {
      // Launch context with extension

      // `dappwright.launch` is used to be able to modify the
      // `waitForTimeout` method in the page to lower the default wait time
      // in dappwright for the initial setup only.
      const { browserContext } = await dappwright.launch("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        headless: process.env.HEADLESS ? process.env.HEADLESS === "true" : true,
      });
      const wallet = await dappwright.getWallet("metamask", browserContext);

      // Override waitForTimeout method in page to lower 3000ms default wait time in dappwright
      // https://github.com/TenKeyLabs/dappwright/blob/386b19987eec2a7de18f98ec8ca86e8096e4a4ba/src/helpers/actions.ts
      const originalWaitForTimeout = wallet.page.waitForTimeout;
      wallet.page.waitForTimeout = async (_ms: number) => {};

      await wallet.setup({
        seed: testApp.walletMnemonic,
      });

      try {
        await wallet.addNetwork({
          networkName: "Hardhat",
          rpc: testApp.mainNodeUrl,
          chainId: 11155111,
          symbol: "SepoliaETH",
        });
        await wallet.switchNetwork("Hardhat");
      } catch {
        throw new Error("Please verify there's a node running at http://localhost:8545");
      }

      for (const i of Object.values(DERIVATION_INDEXES)) {
        if (fastMode && i === DERIVATION_INDEXES.COUNCIL_2) {
          break;
        }
        await wallet.createAccount();
      }

      // Default to security council
      const switcher = new RoleSwitcher(wallet);
      await switcher.council(1);

      // Navigate to the page and connect the wallet
      const page = browserContext.pages()[0];
      if (!page) {
        throw new Error("No page found");
      }

      await page.bringToFront();
      await page.goto("/");
      await page.getByText("Connect Wallet").click();
      await page.getByText("Metamask").click();
      await wallet.approve();

      // Cache context
      sharedBrowserContext = browserContext;

      // Reset waitForTimeout method
      wallet.page.waitForTimeout = originalWaitForTimeout;
    }

    await use(sharedBrowserContext);
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0];
    if (!page) {
      throw new Error("No page found");
    }
    await page.goto("/");
    await use(page);
  },

  wallet: async ({ context }, use) => {
    const metamask = await dappwright.getWallet("metamask", context);
    await use(metamask);
  },

  switcher: async ({ wallet, page }, use) => {
    const switcher = new RoleSwitcher(wallet);
    const original = wallet.confirmTransaction;

    // Each time there is a tx signature we save the address that produced the signature.
    wallet.confirmTransaction = async () => {
      switcher.pushToHistory();
      await original.bind(wallet)();
    };

    await use(switcher);

    // After each test we go through each address that has signed and
    // Clear the tx nonce in metamask.
    // This is because metamask doesn't automatically fix the nonce when it doesn't
    // match with the network. Doing this forces metamask to refresh the nonce.
    const history = switcher.popHistory();
    for (const entry of history) {
      await entry();

      await wallet.page.bringToFront();
      await wallet.page.getByTestId("account-options-menu-button").click();
      await wallet.page.getByTestId("global-menu-settings").click();
      await wallet.page.getByText("Advanced").click();
      await wallet.page.getByText("Clear activity tab data").click();
      await wallet.page.getByRole("button", { name: "Clear", exact: true }).click();
      await wallet.page.locator(".app-header__logo-container").click();
    }
    await page.bringToFront();
  },

  // biome-ignore lint/correctness/noEmptyPattern: playwright fixtures require explicit empty pattern
  testApp: async ({}, use) => {
    await use(testApp);
  },
});
