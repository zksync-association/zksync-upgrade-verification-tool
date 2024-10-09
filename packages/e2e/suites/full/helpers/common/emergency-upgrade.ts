import type { Page } from "@playwright/test";

export async function goToEmergencyIndex(page: Page) {
  await page.goto("/");
  await page.getByText("Emergency Upgrades").click();
  await page.getByText("Active Emergency Proposals", { exact: true }).isVisible();
}

export async function goToCreateEmergencyProposal(page: Page) {
  await goToEmergencyIndex(page);
  await page.getByTestId("new-emergency-proposal").click();
  await page.getByText("Create New Emergency Upgrade").isVisible();
}

export async function createEmergencyProposal(page: Page, title = "Emergency test!!") {
  await goToCreateEmergencyProposal(page);

  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByText("Step 2: Define Upgrade Calls").isVisible();
  await page.getByLabel("Target Address").fill("0x6fe12efa79da1426af9c811b80edca74556c5a0e");
  await page
    .getByLabel("Calldata")
    .fill("0x3fb5c1cb000000000000000000000000000000000000000000000000000000000000000c");

  await page.getByRole("button", { name: "Add Call" }).click();
  await page.getByRole("button", { name: "Next" }).isEnabled();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Validation passed successfully").isVisible();
  await page.getByRole("button", { name: "Submit" }).isEnabled();
  await page.getByRole("button", { name: "Submit" }).click();
}

export async function goToActiveEmergencyProposal(page: Page) {
  await goToEmergencyIndex(page);
  await page.getByText("Title").isVisible();
  const row = page.locator("tbody tr").first();
  await row.getByText("View").click();
}
