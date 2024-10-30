import { test, expect } from "./helpers/dappwright.js";

test.beforeEach(async ({ testApp }) => {
  await testApp.reset();
});

test("TC100 - Login as visitor", async ({ switcher, page }) => {
  await switcher.visitor(page);
  await expect(page.getByTestId("user-role")).toHaveText("Visitor");
});

test("TC101 - Login as security council", async ({ switcher, page }) => {
  await switcher.council(1, page);
  await expect(page.getByTestId("user-role")).toHaveText("Security Council");
});

test("TC102 - Login as guardian", async ({ switcher, page }) => {
  await switcher.guardian(1, page);
  await expect(page.getByTestId("user-role")).toHaveText("Guardian");
});

test("TC103 - Login as zk foundation", async ({ switcher, page }) => {
  await switcher.zkFoundation(page);
  await expect(page.getByTestId("user-role")).toHaveText("ZkSync Foundation");
});

test("TC104 - View all buttons in private app", async ({ page }) => {
  await expect(page.getByText("Protocol Upgrades")).toBeVisible();
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Freeze Requests")).toBeVisible();
  await expect(page.getByText("Guardian Veto")).toBeVisible();
});

test("TC105 - View only protocol upgrades in private app", async ({ testApp, page }) => {
  try {
    await testApp.resetApp({ env: { ALLOW_PRIVATE_ACTIONS: "false" } });
    await page.reload();

    await expect(page.getByText("Protocol Upgrades")).toBeVisible();
    await expect(page.getByText("Emergency Upgrades")).not.toBeVisible();
    await expect(page.getByText("Freeze Requests")).not.toBeVisible();
    await expect(page.getByText("Guardian Veto")).not.toBeVisible();
  } finally {
    // Always reset the app to its initial state, regardless of the test outcome.
    await testApp.resetApp({ env: { ALLOW_PRIVATE_ACTIONS: "true" } });
    await page.reload();
  }
});

test("TC106 - Login as zk admin", async ({ switcher, page }) => {
  await switcher.zkAdmin(page);
  await expect(page.getByTestId("user-role")).toHaveText("ZkAdmin");
});
