import { test, expect } from "./helpers/dappwright.js";
import { TestApp } from "./helpers/test-app.js";

const testApp = new TestApp();

test.beforeEach(async () => {
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
  await expect(page.getByText("Standard Upgrades")).toBeVisible();
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Freeze Requests")).toBeVisible();
  await expect(page.getByText("L2 Proposals Veto")).toBeVisible();
});

test("TC105 - View only standard upgrades in private app", async ({ page }) => {
  await testApp.resetApp({ env: { ALLOW_PRIVATE_ACTIONS: "false" } });

  await expect(page.getByText("Standard Upgrades")).toBeVisible();
  await expect(page.getByText("Emergency Upgrades")).not.toBeVisible();
  await expect(page.getByText("Freeze Requests")).not.toBeVisible();
  await expect(page.getByText("L2 Proposals Veto")).not.toBeVisible();

  await testApp.resetApp({ env: { ALLOW_PRIVATE_ACTIONS: "true" } });
});