import type { Page } from "@playwright/test";
import { createEmergencyProposal } from "./helpers/common/emergency-upgrade.js";
import { createFreeze } from "./helpers/common/freeze.js";
import { expect, type RoleSwitcher, test } from "./helpers/dappwright.js";
import type { TestApp } from "./helpers/test-app.js";
import type { Dappwright } from "@tenkeylabs/dappwright";

test.beforeEach(async ({ testApp, switcher, page }) => {
  await testApp.reset();
  await switcher.zkAdmin(page);
});

test("TC501: Archive active emergency proposal", async ({ testApp, page, wallet, switcher }) => {
  await createEmergencyProposal(page);
  await archiveProposal({ page, wallet, testApp });
  await verifyProposalIsArchived({ page, switcher });
});

test("TC502: Archive active soft freeze proposal", async ({ testApp, page, wallet, switcher }) => {
  await createFreeze(page, "SOFT_FREEZE");
  await archiveProposal({ page, wallet, testApp });
  await verifyProposalIsArchived({ page, switcher });
});

test("TC503: Archive active hard freeze proposal", async ({ testApp, page, wallet, switcher }) => {
  await createFreeze(page, "HARD_FREEZE");
  await archiveProposal({ page, wallet, testApp });
  await verifyProposalIsArchived({ page, switcher });
});

test("TC504: Archive active unfreeze proposal", async ({ testApp, page, wallet, switcher }) => {
  await createFreeze(page, "UNFREEZE");
  await archiveProposal({ page, wallet, testApp });
  await verifyProposalIsArchived({ page, switcher });
});

test("TC505: Archive active set soft freeze threshold proposal", async ({
  testApp,
  page,
  wallet,
  switcher,
}) => {
  await createFreeze(page, "SET_SOFT_FREEZE_THRESHOLD", 3);
  await archiveProposal({ page, wallet, testApp });
  await verifyProposalIsArchived({ page, switcher });
});

async function archiveProposal({
  page,
  wallet,
  testApp,
}: { page: Page; wallet: Dappwright; testApp: TestApp }) {
  const archiveProposalButton = page.getByRole("button", { name: "Archive Proposal" });
  await archiveProposalButton.click();
  await page.getByLabel("Reason for archiving").fill("Test reason");

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await wallet.sign();
  await expect(page.getByText("Archived successfully")).toBeVisible();

  const detailsCard = page.getByTestId("proposal-details-card");
  await expect(detailsCard.getByText("Archived On")).toBeVisible();
  await expect(detailsCard.getByText("Archived Reason")).toBeVisible();
  await expect(detailsCard.getByText("Test reason")).toBeVisible();
  await expect(detailsCard.getByText("Archived By")).toBeVisible();
  await expect(detailsCard.getByText(testApp.zkAdminAddress.toLowerCase())).toBeVisible();

  await expect(archiveProposalButton).toBeDisabled();
}

async function verifyProposalIsArchived({
  page,
  switcher,
}: { page: Page; switcher: RoleSwitcher }) {
  const roles = [
    () => switcher.council(1),
    () => switcher.guardian(1),
    () => switcher.visitor(page),
    () => switcher.zkAdmin(page),
  ];

  for (const role of roles) {
    // Activate role
    await role();

    // Check that all buttons are disabled
    for (const card of ["role-actions-card", "execute-actions-card"]) {
      await expect(page.getByTestId(card)).toBeVisible();
      const buttons = await page.getByTestId(card).getByRole("button").all();
      for (const button of buttons) {
        await expect(button).toBeDisabled();
      }
    }
  }
}
