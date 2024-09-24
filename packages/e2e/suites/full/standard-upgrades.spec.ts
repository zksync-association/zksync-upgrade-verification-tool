import type { Page } from "@playwright/test";
import { test, expect, type IntRange } from "./helpers/dappwright.js";
import { TestApp } from "./helpers/test-app.js";

const testApp = new TestApp();

test.beforeEach(async ({ page }) => {
  await testApp.reset();
  await page.goto("/app/proposals");
});

test("TC001 - Verify proposals page loads correctly", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Active Standard Proposals", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Inactive Standard Proposals", exact: true })
  ).toBeVisible();
});

test("TC002 - Check list of active proposals is display with active proposals", async ({
  page,
}) => {
  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..")
    .locator("..");

  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await expect(proposalButton).toBeVisible();
});

test("TC003 - Check list of active proposals is displayed without active proposals", async ({
  page,
}) => {
  await testApp.increaseBlockTimestamp({ days: 40 });
  await page.reload();
  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals", exact: true })
    .locator("..")
    .locator("..")
    .locator("..");
  await expect(activeProposalsSection.getByRole("button")).not.toBeAttached();
  await expect(
    activeProposalsSection.getByText("No active standard proposals found.")
  ).toBeVisible();
});

test("TC004 - Check list of inactive proposals is displayed with inactive proposals", async ({
  page,
}) => {
  await testApp.increaseBlockTimestamp({ days: 40 });
  await page.reload();
  const inactiveProposalsSection = page
    .getByRole("heading", { name: "Inactive Standard Proposals" })
    .locator("..")
    .locator("..")
    .locator("..");
  const proposalButton = inactiveProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await expect(proposalButton).toBeVisible();
});

test("TC005 - Check list of inactive proposals is displayed without inactive proposals", async ({
  page,
}) => {
  const inactiveProposalsSection = page
    .getByRole("heading", { name: "Inactive Standard Proposals" })
    .locator("..")
    .locator("..")
    .locator("..");
  await expect(inactiveProposalsSection.getByRole("button")).toHaveCount(0);
  await expect(
    inactiveProposalsSection.getByText("No inactive standard proposals found.")
  ).toBeVisible();
});

test("TC006 - Verify proposal details are correctly displayed on an active proposal", async ({
  page,
}) => {
  await goToProposalDetails(page);

  await expect(page.getByText("Proposal Details")).toBeVisible();
  await expect(page.getByText("Current Version")).toBeVisible();
  await expect(page.getByText("Proposed Version")).toBeVisible();
  await expect(page.getByText("Proposal ID")).toBeVisible();
  await expect(page.getByText("Proposed On")).toBeVisible();
  await expect(page.getByText("Executor")).toBeVisible();
  await expect(page.getByText("Transaction hash")).toBeVisible();

  await expect(page.getByText("Proposal Status")).toBeVisible();
  await expect(page.getByText("Security Council Approvals")).toBeVisible();
  await expect(page.getByText("Guardian Approvals")).toBeVisible();
  await expect(page.getByText("Extend Legal Veto Approvals")).toBeVisible();
});

test("TC007 - Verify proposal details are correctly displayed on an inactive proposal", async ({
  page,
}) => {
  await testApp.increaseBlockTimestamp({ days: 40 });
  await page.reload();
  const inactiveProposalsSection = page
    .getByRole("heading", { name: "Inactive Standard Proposals" })
    .locator("..")
    .locator("..")
    .locator("..");
  const proposalButton = inactiveProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();

  await expect(page.getByText("Proposal Details")).toBeVisible();
  await expect(page.getByText("Current Version")).toBeVisible();
  await expect(page.getByText("Proposed Version")).toBeVisible();
  await expect(page.getByText("Proposal ID")).toBeVisible();
  await expect(page.getByText("Proposed On")).toBeVisible();
  await expect(page.getByText("Executor")).toBeVisible();
  await expect(page.getByText("Transaction hash")).toBeVisible();

  await expect(page.getByText("Proposal Status")).toBeVisible();
  await expect(page.getByText("Security Council Approvals")).toBeVisible();
  await expect(page.getByText("Guardian Approvals")).toBeVisible();
  await expect(page.getByText("Extend Legal Veto Approvals")).toBeVisible();

  await expect(page.getByText("EXPIRED")).toBeVisible();

  // Check if all buttons are disabled
  const roleActions = page.getByTestId("role-actions");
  const roleButtons = await roleActions.locator("button").all();
  for (const button of roleButtons) {
    await expect(button).toBeDisabled();
  }

  const proposalActions = page.getByTestId("proposal-actions");
  const buttons = await proposalActions.locator("button").all();
  for (const button of buttons) {
    await expect(button).toBeDisabled();
  }
});

test("TC008 - Verify a guardian can only see guardian role actions", async ({ page, switcher }) => {
  await switcher.guardian(1, page);
  await goToProposalDetails(page);

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).not.toBeVisible();
  await expect(roleActions.getByText("No role actions")).not.toBeVisible();
  await expect(roleActions.getByText("ZK Foundation Actions")).not.toBeVisible();

  const buttons = await roleActions.getByRole("button").all();
  expect(buttons.length).toBe(2);
  await expect(roleActions.getByRole("button", { name: "Extend Legal Veto Period" })).toBeVisible();
  await expect(roleActions.getByRole("button", { name: "Approve Upgrade" })).toBeVisible();
});

test("TC009 - Verify a council member can only see council role actions", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);
  await goToProposalDetails(page);

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).not.toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).toBeVisible();
  await expect(roleActions.getByText("No role actions")).not.toBeVisible();

  const buttons = await roleActions.getByRole("button").all();
  expect(buttons.length).toBe(1);
  await expect(roleActions.getByRole("button", { name: "Approve Upgrade" })).toBeVisible();
});

test("TC010 - Verify a visitor can't see any role actions", async ({ page, switcher }) => {
  await switcher.visitor(page);
  await goToProposalDetails(page);

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).not.toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).not.toBeVisible();
  await expect(roleActions.getByText("No role actions")).toBeVisible();
});

test("TC011 - Verify a zkFoundation can't see any role actions", async ({ page, switcher }) => {
  await switcher.zkFoundation(page);
  await goToProposalDetails(page);

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).not.toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).not.toBeVisible();
  await expect(roleActions.getByText("No role actions")).toBeVisible();
});

test("TC012 - Verify a security council approval can be executed", async ({
  page,
  switcher,
  wallet,
}) => {
  await goToProposalDetails(page);

  for (let i = 1; i <= 6; i++) {
    await switcher.council(i as IntRange<1, 12>, page);
    await page.getByRole("button", { name: "Approve Upgrade" }).click();
    await wallet.sign();
    await expect(page.getByTestId("council-signature-count")).toHaveText(`${i}/6`);
  }

  await expect(page.getByText("LEGAL VETO PERIOD")).toBeVisible();
  await testApp.increaseBlockTimestamp({ days: 4 });
  await page.reload();
  await expect(page.getByText("WAITING")).toBeVisible();

  await page.getByText("Execute security council approval").click();
  await wallet.confirmTransaction();

  await expect(page.getByText("Transaction successful")).toBeVisible();
});

test("TC013 - Verify a guardian approval can be executed", async ({ page, switcher, wallet }) => {
  await goToProposalDetails(page);

  // First switch to guardian 1 and wait for 1 second to make sure guardian role is correctly switched
  await switcher.guardian(1, page);
  await page.waitForTimeout(1000);

  for (let i = 1; i <= 5; i++) {
    await switcher.guardian(i as IntRange<1, 8>, page);
    await page.getByRole("button", { name: "Approve Upgrade" }).click();
    await wallet.sign();
    await expect(page.getByTestId("guardian-signature-count")).toHaveText(`${i}/5`);
  }

  await expect(page.getByText("LEGAL VETO PERIOD (day 1 out of 3)", { exact: true })).toBeVisible();
  await testApp.increaseBlockTimestamp({ days: 4 });
  await page.reload();
  await expect(page.getByText("WAITING")).toBeVisible();

  await page.getByText("Execute guardian approval").click();
  await wallet.confirmTransaction();

  await expect(page.getByText("Transaction successful")).toBeVisible();
});

test("TC014 - Verify a legal veto extension can be executed", async ({
  page,
  switcher,
  wallet,
}) => {
  await goToProposalDetails(page);

  // First switch to guardian 1 and wait for 1 second to make sure guardian role is correctly switched
  await switcher.guardian(1, page);
  await page.waitForTimeout(1000);

  for (let i = 1; i <= 2; i++) {
    await switcher.guardian(i as IntRange<1, 8>, page);
    await page.getByRole("button", { name: "Extend legal veto period" }).click();
    await wallet.sign();
    await expect(page.getByTestId("legal-veto-signature-count")).toHaveText(`${i}/2`);
  }

  await page.getByText("Execute legal veto extension").click();
  await wallet.confirmTransaction();

  await expect(page.getByText("Transaction successful")).toBeVisible();
});

test("TC015 - Verify a proposal can be executed by anyone", async ({ page, switcher, wallet }) => {
  await goToProposalDetails(page);

  // First switch to guardian 1 and wait for 1 second to make sure guardian role is correctly switched
  await switcher.guardian(1, page);
  await page.waitForTimeout(1000);

  for (let i = 1; i <= 5; i++) {
    await switcher.guardian(i as IntRange<1, 8>, page);
    await page.getByRole("button", { name: "Approve Upgrade" }).click();
    await wallet.sign();
    await expect(page.getByTestId("guardian-signature-count")).toHaveText(`${i}/5`);
  }

  await expect(page.getByText("LEGAL VETO PERIOD (day 1 out of 3)", { exact: true })).toBeVisible();
  await testApp.increaseBlockTimestamp({ days: 4 });
  await page.reload();
  await expect(page.getByText("WAITING")).toBeVisible();

  await page.getByRole("button", { name: "Execute guardian approval" }).click();
  await wallet.confirmTransaction();

  await expect(page.getByText("Transaction successful")).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Proposal Details")).toBeVisible();

  await testApp.increaseBlockTimestamp({ days: 31 });
  await page.reload();

  await switcher.visitor(page);
  await page.getByRole("button", { name: "Execute Upgrade" }).click();
  await wallet.confirmTransaction();
  await expect(page.getByText("Transaction successful")).toBeVisible();
});

test("TC016: Click in plus button -> Start regular upgrade flow page is shown. Upgrades ready in l2 are displayed", async ({
  page,
}) => {
  await goToStartProposal(page);

  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(
    page.getByText("68693134686067409446318095868434117916042803819816398115405085560523995847566")
  ).toBeVisible();
  await expect(page.getByText("0xe08b76f3")).toBeVisible();
});

test("TC017: Start new regular upgrade page -> Upgrade can be started. Redirects to tx page. -> New upgrade is displayed in index page", async ({
  page,
  wallet,
}) => {
  await goToStartProposal(page);

  await page
    .getByText(/0x[a-fA-F0-9]{8}...[a-fA-F0-9]{10}/)
    .locator("..")
    .locator('[name="proposal"]')
    .click();

  await page.getByRole("button", { name: "Start" }).click();
  await wallet.confirmTransaction();

  await page.getByText("Transaction successful").waitFor();

  await page.goto("/app/proposals");
  await page.getByText("Active Standard Proposals", { exact: true }).waitFor();

  const buttons = await page.getByText(/^0x[a-fA-F0-9]{64}$/).all();
  expect(buttons.length).toBe(2);
});

async function goToStartProposal(page: Page) {
  await page.getByTestId("start-regular-upgrade").click();
  await page.getByText("Start regular upgrade flow").waitFor();
}

async function goToProposalDetails(page: Page) {
  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();
  await expect(page.getByText("Proposal Details")).toBeVisible();
}
