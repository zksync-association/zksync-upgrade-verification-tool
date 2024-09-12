import { expect, type IntRange, type RoleSwitcher, test } from "./helpers/dappwright.js";
import type { Page } from "@playwright/test";
import type { Dappwright as Wallet } from "@tenkeylabs/dappwright";
import type { COUNCIL_SIZE } from "@repo/contracts/helpers/constants";
import { TestApp } from "./helpers/test-app.js";

const testApp = new TestApp();

test.beforeEach(async ({ page }) => {
  await testApp.reset();
  await page.goto("/");
});

async function goToEmergencyIndex(page: Page) {
  await page.goto("/");
  await page.getByText("Emergency Upgrades").click();
  await page.getByText("Active Emergency Proposals", { exact: true }).isVisible();
}

test("TC213: Go to / -> Emergency upgrade button is enabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Emergency Upgrades")).toBeEnabled();
})

test("TC201: Go to index page, no proposals -> active and inactive emergency upgrades empty", async ({ page }) => {
  await goToEmergencyIndex(page);

  await expect(page.getByText("No active emergency proposals found.")).toBeVisible();
  await expect(page.getByText("No inactive emergency proposals found.")).toBeVisible();
})

async function createEmergencyProposal(page: Page, title="Emergency test!!") {
  await goToEmergencyIndex(page);
  await page.getByTestId("new-emergency-proposal").click();
  await page.getByText("Create new emergency proposal").isVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByText("Define upgrade calls").isVisible();
  await page.getByLabel("Target Address").fill("0x6fe12efa79da1426af9c811b80edca74556c5a0e");
  await page.getByLabel("Calldata").fill("0x3fb5c1cb000000000000000000000000000000000000000000000000000000000000000c");

  await page.getByRole("button", { name: "Add call" }).click();
  await page.getByRole("button", { name: "Next" }).isEnabled();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Validations ok").isVisible();
  await page.getByRole("button", { name: "Submit" }).isEnabled();
  await page.getByRole("button", { name: "Submit" }).click();
}

test("TC202: Create a valid emergency proposal -> List it into active proposals", async ({ page }) => {
  await createEmergencyProposal(page, "TC202");
  await goToEmergencyIndex(page);
  await page.getByText("title").isVisible();
  const rows = await page.locator("tbody tr").all()
  expect(rows.length).toBe(1)
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Missing row with created upgraded.")
  }
  await row.getByText("TC202").isVisible()
  await row.getByText("ACTIVE").isVisible()
  await row.getByText("View").isVisible()
})
