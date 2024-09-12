import { test, expect } from "./helpers/dappwright.js";
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
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await expect(proposalButton).toBeVisible();
});

test("TC003 - Check list of active proposals is displayed without active proposals", async ({
  page,
}) => {
  await testApp.mineBlocksInMainNode(10_000_000);
  await page.reload();
  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals", exact: true })
    .locator("..")
    .locator("..");
  await expect(activeProposalsSection.getByRole("button")).toHaveCount(0);
  await expect(
    activeProposalsSection.getByText("No active standard proposals found.")
  ).toBeVisible();
});

test("TC004 - Check list of inactive proposals is displayed with inactive proposals", async ({
  page,
}) => {
  await testApp.mineBlocksInMainNode(10_000_000);
  await page.reload();
  const inactiveProposalsSection = page
    .getByRole("heading", { name: "Inactive Standard Proposals" })
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
    .locator("..");
  await expect(inactiveProposalsSection.getByRole("button")).toHaveCount(0);
  await expect(
    inactiveProposalsSection.getByText("No inactive standard proposals found.")
  ).toBeVisible();
});

test("TC006 - Verify proposal details are correctly displayed on an active proposal", async ({
  page,
}) => {
  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals", exact: true })
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
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
});

test("TC007 - Verify proposal details are correctly displayed on an inactive proposal", async ({
  page,
}) => {
  await testApp.mineBlocksInMainNode(10_000_000);
  await page.reload();
  const inactiveProposalsSection = page
    .getByRole("heading", { name: "Inactive Standard Proposals" })
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

  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();

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

  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();

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

  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).not.toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).not.toBeVisible();
  await expect(roleActions.getByText("No role actions")).toBeVisible();
});

test("TC011 - Verify a zkFoundation can't see any role actions", async ({ page, switcher }) => {
  await switcher.zkFoundation(page);

  const activeProposalsSection = page
    .getByRole("heading", { name: "Active Standard Proposals" })
    .locator("..")
    .locator("..");
  const proposalButton = activeProposalsSection.getByRole("button", {
    name: /^0x[a-fA-F0-9]{64}$/,
  });
  await proposalButton.click();

  const roleActions = page.getByTestId("role-actions");
  await expect(roleActions.getByText("Guardian Actions")).not.toBeVisible();
  await expect(roleActions.getByText("Security Council Actions")).not.toBeVisible();
  await expect(roleActions.getByText("No role actions")).toBeVisible();
});
