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

export { expect } from "@playwright/test";

type Enumerate<N extends number, Acc extends number[] = []> = Acc["length"] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc["length"]]>;

/** IntRange is a type that represents a range of numbers from F to T inclusive */
type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>> | T;

let sharedBrowserContext: BrowserContext;

// Fast mode limits the number of accounts created to 1 per role
const fastMode = process.env.TEST_FAST_MODE === "true";

export class RoleSwitcher {
  private wallet: Dappwright;

  constructor(wallet: Dappwright) {
    this.wallet = wallet;
  }

  async council(councilNumber: IntRange<1, typeof COUNCIL_SIZE>, page?: Page) {
    if (fastMode && councilNumber !== 1) {
      throw new Error("Fast mode does not support council numbers other than 1");
    }
    const index = COUNCIL_INDEXES[councilNumber - 1] as number;
    await this.switchToIndex(index, page);
  }

  async guardian(guardianNumber: IntRange<1, typeof GUARDIANS_SIZE>, page?: Page) {
    if (fastMode && guardianNumber !== 1) {
      throw new Error("Fast mode does not support guardian numbers other than 1");
    }
    const index = GUARDIAN_INDEXES[guardianNumber - 1] as number;
    await this.switchToIndex(index, page);
  }

  async zkFoundation(page?: Page) {
    await this.switchToIndex(DERIVATION_INDEXES.ZK_FOUNDATION, page);
  }

  async visitor(page?: Page) {
    await this.switchToIndex(DERIVATION_INDEXES.VISITOR, page);
  }

  private async switchToIndex(index: number, page?: Page) {
    // Accounts in metamask are 1 indexed
    await this.wallet.switchAccount(index + 1);
    await page?.bringToFront();
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

      // `dappwright.launch` is used to be able to modify the
      // `waitForTimeout` method in the page to lower the default wait time
      // in dappwright for the initial setup only.
      const { browserContext } = await dappwright.launch("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        headless: false,
      });
      const wallet = await dappwright.getWallet("metamask", browserContext);

      // Override waitForTimeout method in page to lower 3000ms default wait time in dappwright
      // https://github.com/TenKeyLabs/dappwright/blob/386b19987eec2a7de18f98ec8ca86e8096e4a4ba/src/helpers/actions.ts
      const originalWaitForTimeout = wallet.page.waitForTimeout;
      wallet.page.waitForTimeout = async (_ms: number) => {};

      await wallet.setup({
        seed:
          process.env.MNEMONIC ||
          "draw drastic exercise toilet stove bone grit clutch any stand phone ten",
      });

      try {
        await wallet.addNetwork({
          networkName: "Hardhat",
          rpc: "http://localhost:8545",
          chainId: 11155111,
          symbol: "SepoliaETH",
        });
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
      const newPage = await browserContext.newPage();
      await newPage.goto("http://localhost:3000");
      await newPage.getByText("Connect Wallet").click();
      await newPage.getByText("Metamask").click();
      await wallet.approve();
      await newPage.close();

      // Cache context
      sharedBrowserContext = browserContext;

      // Reset waitForTimeout method
      wallet.page.waitForTimeout = originalWaitForTimeout;
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
