import { test, expect } from "../../helpers/dappwright.js";

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto("http://localhost:3000");
});

test("should be able to connect", async ({ wallet, page }, testInfo) => {
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Standard Upgrades")).toBeVisible();
});

test("should be able to see an active standard proposal", async ({ wallet, page }, testInfo) => {
  await page.getByText("Standard Upgrades").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("No active standard proposals found")).not.toBeVisible();
  await expect(page.getByText("No inactive standard proposals found")).toBeVisible();

  const activeProposal = page.getByRole("button", { name: /^0x/ }).first();
  await expect(activeProposal).toBeVisible();
  await expect(activeProposal).toBeEnabled();

  const activeProposalAgain = page.getByTestId(/^proposal-0x/);
  await expect(activeProposalAgain).toBeVisible();
  await expect(activeProposalAgain).toBeEnabled();
});

// add test for login as visitor

// add test for login as guardian

// add test for standard proposal navigation

// add test for standard signing

// add test to enact standard proposal

// add test for empty emergency upgrades

// add test to add emergency upgrade

// add test to detail emergency upgrade

// add test to sign emergency upgrade

// add test to enact emergency upgrade
