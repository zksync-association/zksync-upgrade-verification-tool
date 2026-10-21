import { expect, test } from "@playwright/test";
import { startSafeShell } from "./safe-shell";
import {
  ANVIL_URL,
  APP_URL,
  OTHER_SHELL_PORT,
  SAFE_SHELL_PORT,
  UNSIGNED_MEMBER,
  resetAll,
} from "./support";

// Safe{Wallet} can open the app as a Safe App; no other site may embed it. Here a local page plays
// Safe{Wallet}.

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

test("a site that isn't a configured Safe{Wallet} can't embed the app", async ({ page }) => {
  // Control: the same page renders through the allowed shell.
  await page.goto(shellPage(SAFE_SHELL_PORT, "/"));
  await expect(page.frameLocator("#app").getByTestId("network-pill")).toHaveCount(1);

  await page.goto(shellPage(OTHER_SHELL_PORT, "/"));
  await page.waitForFunction(() => window.__frameLoaded === true);
  await expect(page.frameLocator("#app").getByTestId("network-pill")).toHaveCount(0);
  expect(await page.evaluate(() => window.__safeRequests.length)).toBe(0);
});
