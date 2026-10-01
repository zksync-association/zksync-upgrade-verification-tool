import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
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

declare global {
  interface Window {
    __walletRequests: { method: string; params: unknown }[];
  }
}

/**
 * An injected EIP-1193 wallet for `account`: records signature requests (and answers them with a
 * dummy signature, like a Safe that has not collected owner signatures yet) and forwards
 * everything else, including eth_sendTransaction, to the fork.
 */
export async function installWallet(page: Page, account: Address) {
  await chain.test.impersonateAccount({ address: account });
  await chain.test.setBalance({ address: account, value: 10n ** 20n });
  await page.addInitScript(
    ({ account, rpc }) => {
      window.__walletRequests = [];
      const forward = async (method: string, params: unknown) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const body = (await res.json()) as {
          result?: unknown;
          error?: { message: string; code: number };
        };
        if (body.error)
          throw Object.assign(new Error(body.error.message), { code: body.error.code });
        return body.result;
      };
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      (window as unknown as { ethereum: unknown }).ethereum = {
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          window.__walletRequests.push({ method, params });
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [account];
            case "eth_chainId":
              return "0x1";
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "eth_signTypedData_v4":
              return `0x${"11".repeat(65)}`;
            default:
              return forward(method, params ?? []);
          }
        },
        on: (event: string, fn: (...args: unknown[]) => void) => {
          handlers[event] = [...(handlers[event] ?? []), fn];
        },
        removeListener: (event: string, fn: (...args: unknown[]) => void) => {
          handlers[event] = (handlers[event] ?? []).filter((f) => f !== fn);
        },
      };
    },
    { account, rpc: ANVIL_URL }
  );
}

/** Connects the injected test wallet (wagmi may already have reconnected it on load). */
export async function connectWallet(page: Page) {
  const connected = page.getByTestId("connected-account");
  const connect = page.getByTestId("connect-wallet");
  await connected.or(connect).first().waitFor();
  if (await connect.isVisible()) {
    await connect.click();
    await page.getByRole("button", { name: /Browser Wallet/i }).click();
  }
  await connected.waitFor();
}
