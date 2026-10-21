import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Page, test as base, expect } from "@playwright/test";
import type { Address, Hex } from "viem";
import { TEST_OWNER, forkActions, signAsSafeOwner } from "../../../../apps/web/test/support/fork";
import {
  type GovernanceTypedData,
  buildTypedData,
  governanceHashes,
} from "../../../../apps/web/app/common/typed-data";

export const ANVIL_PORT = 18645;
export const SAFE_PORT = 18646;
export const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
export const SAFE_URL = `http://127.0.0.1:${SAFE_PORT}`;
export const APP_URL = "http://127.0.0.1:4000";
// A stand-in for Safe{Wallet} the app accepts as a Safe App host, and one it doesn't.
export const SAFE_SHELL_PORT = 18647;
export const OTHER_SHELL_PORT = 18648;
export const SNAPSHOT_FILE = path.join(tmpdir(), "zksync-governance-e2e-snapshot");

export const UPGRADE_ID = "0x77d5461c37515d627820ab6573efe63fb0b253cf83308dbb368b859e9835eaaa";
export const COUNCIL = "0x59195219d1176E42f8e607e9AC114926D47f9035" as const;
// OpenZeppelin's member Safe: the one Security Council member that has not signed 0x77d5….
export const UNSIGNED_MEMBER = "0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a" as const;

export const chain = forkActions(ANVIL_URL);

/** Back to the state right after global setup (fork block, recorded Safe messages, empty caches). */
export async function resetAll() {
  await chain.revert(readFileSync(SNAPSHOT_FILE, "utf8").trim() as Hex);
  writeFileSync(SNAPSHOT_FILE, await chain.snapshot());
  await fetch(`${SAFE_URL}/__test__/reset`, { method: "POST" });
  await refreshApp();
}

export const refreshApp = () => fetch(`${APP_URL}/resources/refresh`, { method: "POST" });

/** Makes the test key an owner of `safe` on the fork and files its signature in the mock Safe API. */
export async function signInSafe(safe: Address, typedData: GovernanceTypedData) {
  await chain.takeOver(safe);
  const { digest } = governanceHashes(typedData);
  const signature = await signAsSafeOwner(safe, digest);
  await fetch(`${SAFE_URL}/__test__/add`, {
    method: "POST",
    body: JSON.stringify({
      safe,
      typedData,
      confirmations: [{ owner: TEST_OWNER.address, signature }],
    }),
  });
}

export { buildTypedData };

/**
 * The app's pages, interactive once open: `goto` and `reload` also wait until React has hydrated
 * every element a test can reach (each then carries its fiber). A section's data is streamed with
 * the page, but React hydrates it only after its promise resolves on the client; a click on it
 * before that is dropped, not replayed, and on a slow runner that comes well after the load event.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const interactive = () =>
      page.waitForFunction(() =>
        Array.from(document.querySelectorAll("[data-testid]")).every((el) =>
          Object.keys(el).some((key) => key.startsWith("__reactFiber$"))
        )
      );
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url: string, options?: Parameters<Page["goto"]>[1]) => {
      const response = await goto(url, options);
      await interactive();
      return response;
    };
    page.reload = async (options?: Parameters<Page["reload"]>[0]) => {
      const response = await reload(options);
      await interactive();
      return response;
    };
    await use(page);
  },
});
export { expect };
