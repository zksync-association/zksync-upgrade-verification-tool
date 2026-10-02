import { expect, test } from "@playwright/test";
import { startSafeShell } from "./safe-shell";
import {
  ANVIL_URL,
  APP_URL,
  COUNCIL,
  OTHER_SHELL_PORT,
  SAFE_SHELL_PORT,
  UNSIGNED_MEMBER,
  UPGRADE_ID,
  resetAll,
} from "./support";

// Members can open the app inside Safe{Wallet} as a Safe App: it connects to the open Safe on its
// own, and signing and executing go to that Safe. Here a local page plays Safe{Wallet}.

let shells: Awaited<ReturnType<typeof startSafeShell>>[] = [];

test.beforeAll(async () => {
  shells = await Promise.all(
    [SAFE_SHELL_PORT, OTHER_SHELL_PORT].map((port) =>
      startSafeShell({ port, appUrl: APP_URL, rpcUrl: ANVIL_URL })
    )
  );
});
test.afterAll(async () => {
  await Promise.all(shells.map((s) => s.close()));
});
test.beforeEach(async () => {
  await resetAll();
});

const shellPage = (port: number, path: string) =>
  `http://127.0.0.1:${port}/?safe=${UNSIGNED_MEMBER}&path=${encodeURIComponent(path)}`;

test("Safe{Wallet} can read the manifest; only Safe{Wallet} may embed the app", async ({
  request,
}) => {
  const manifest = await request.get(`${APP_URL}/manifest.json`);
  expect(manifest.headers()["access-control-allow-origin"]).toBe("*");
  expect(await manifest.json()).toMatchObject({
    name: "ZKsync Governance",
    iconPath: "safe-app-icon.svg",
  });
  const icon = await request.get(`${APP_URL}/safe-app-icon.svg`);
  expect(icon.ok()).toBe(true);
  expect(icon.headers()["access-control-allow-origin"]).toBe("*");

  const home = await request.get(APP_URL);
  expect(home.headers()["content-security-policy"]).toBe(
    `frame-ancestors 'self' https://app.safe.global http://127.0.0.1:${SAFE_SHELL_PORT}`
  );
});

test("inside Safe{Wallet} the app connects to the open Safe and signs through it", async ({
  page,
}) => {
  await page.goto(shellPage(SAFE_SHELL_PORT, `/app/proposals/${UPGRADE_ID}`));
  const app = page.frameLocator("#app");
  await expect(app.getByTestId("connected-account")).toContainText("Security Council");

  const council = app.getByTestId("set-securityCouncil");
  await council.getByTestId("sign-button").click();
  await app.getByTestId("confirm-sign").click();

  await expect
    .poll(() =>
      page.evaluate(() => window.__safeRequests.filter((r) => r.method === "signTypedMessage"))
    )
    .toHaveLength(1);
  const [request] = await page.evaluate(() =>
    window.__safeRequests.filter((r) => r.method === "signTypedMessage")
  );
  const { typedData } = request?.params as {
    typedData: {
      primaryType: string;
      domain: { name: string; version: string; chainId: number; verifyingContract: string };
      message: { id: string };
    };
  };
  expect(typedData.primaryType).toBe("ApproveUpgradeSecurityCouncil");
  expect(typedData.domain).toMatchObject({ name: "SecurityCouncil", version: "1", chainId: 1 });
  expect(typedData.domain.verifyingContract.toLowerCase()).toBe(COUNCIL.toLowerCase());
  expect(typedData.message.id).toBe(UPGRADE_ID);
});

test("inside Safe{Wallet} executing creates a Safe transaction with the page's calldata", async ({
  page,
}) => {
  await page.goto(shellPage(SAFE_SHELL_PORT, `/app/proposals/${UPGRADE_ID}`));
  const app = page.frameLocator("#app");
  await expect(app.getByTestId("connected-account")).toContainText("Security Council");

  const council = app.getByTestId("set-securityCouncil");
  const calldata = await council.getByTestId("calldata").innerText();
  await council.getByRole("button", { name: "Create Safe transaction" }).click();
  await expect(council.getByTestId("safe-tx-created")).toContainText(`0x${"22".repeat(32)}`);

  const sent = await page.evaluate(() =>
    window.__safeRequests.filter((r) => r.method === "sendTransactions")
  );
  expect(sent).toHaveLength(1);
  const { txs } = sent[0]?.params as { txs: { to: string; data: string; value: string }[] };
  expect(txs).toHaveLength(1);
  expect(txs[0]?.to.toLowerCase()).toBe(COUNCIL.toLowerCase());
  expect(txs[0]?.data).toBe(calldata.trim());
});

test("a site that isn't a configured Safe{Wallet} can't embed the app", async ({ page }) => {
  // Control: the same page renders through the allowed shell.
  await page.goto(shellPage(SAFE_SHELL_PORT, "/"));
  await expect(page.frameLocator("#app").getByTestId("network-pill")).toHaveCount(1);

  await page.goto(shellPage(OTHER_SHELL_PORT, "/"));
  await page.waitForFunction(() => window.__frameLoaded === true);
  await expect(page.frameLocator("#app").getByTestId("network-pill")).toHaveCount(0);
  expect(await page.evaluate(() => window.__safeRequests.length)).toBe(0);
});
