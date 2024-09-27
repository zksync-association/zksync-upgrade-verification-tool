import { expect, type IntRange, type RoleSwitcher, test } from "./helpers/dappwright.js";
import type { Page } from "@playwright/test";
import type { Dappwright as Wallet } from "@tenkeylabs/dappwright";
import type { COUNCIL_SIZE } from "@repo/contracts/helpers/constants";
import { createFreeze, goToFreezeIndex } from "./helpers/common/freeze.js";

test.beforeEach(async ({ testApp }) => {
  await testApp.reset();
});

function compareExtractedTextWithDate(extractedText: string | null, expectedDate: Date) {
  const expectedNumber = Math.floor(expectedDate.valueOf() / 1000);
  const number = Number(extractedText?.replace("(", "").replace(")", ""));
  expect(number).toBeLessThan(expectedNumber + 10);
  expect(number).toBeGreaterThan(expectedNumber - 10);
}

async function goToFreezeDetailsPage(page: Page, kind: string) {
  await goToFreezeIndex(page);

  await page
    .getByTestId(`${kind}-proposals`)
    .getByText(/Proposal \d+/)
    .click();

  await page.getByText("Proposal Details").isVisible();
}

async function assertCannotSignProposal(
  page: Page,
  kind: "SOFT_FREEZE" | "HARD_FREEZE" | "UNFREEZE"
) {
  await createFreeze(page, kind);
  await goToFreezeDetailsPage(page, kind);

  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", { name: "Approve" }).all();
  expect(approveButtons).toHaveLength(0);
}

async function withVoteIncrease(page: Page, fn: () => Promise<void>) {
  const initialApprovals = await page.getByTestId("signature-count").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  await fn();

  await expect(page.getByTestId("signature-count")).toHaveText(
    new RegExp(`${initialCount + 1}\/\\d`)
  );
}

async function applyApprovals(
  page: Page,
  kind: string,
  switcher: RoleSwitcher,
  wallet: Wallet,
  councilIndexes: IntRange<1, typeof COUNCIL_SIZE>[]
) {
  await goToFreezeDetailsPage(page, kind);

  for (const index of councilIndexes) {
    await switcher.council(index, page);
    await approveFreeze(page, wallet);
  }
}

async function broadcastAndCheckFreeze(page: Page, wallet: Wallet) {
  const broadcastButton = page.getByRole("button", { name: "Execute freeze" });
  await expect(broadcastButton).toBeEnabled();

  await broadcastButton.click();
  await wallet.confirmTransaction();

  await page.waitForURL("**/transactions/**");
  const txid = await page.getByTestId("transaction-hash").textContent();

  expect(txid).toMatch(/^0x[0-9a-fA-F]+$/);
  await page.goBack();
  await page.getByText("Proposal Details").isVisible();
  await expect(page.getByText("Transaction Hash:")).toBeVisible();
}

async function createChangeThreshold(page: Page, newThreshold = 2) {
  await goToFreezeIndex(page);
  await page.getByTestId("change-threshold-create-btn").click();
  await page.locator("[name='threshold']").fill(newThreshold.toString());
  await page.getByRole("button", { name: "Create" }).click();
}

function approveButton(page: Page) {
  return page.getByTestId("approve-button");
}

async function approveFreeze(page: Page, wallet: Wallet) {
  await approveButton(page).click();
  await wallet.sign();
}

// General tests

test("TC300: Navigate to freeze index button is enabled", async ({ page, switcher }) => {
  await switcher.council(1, page);
  const freezeButton = page.getByText("Freeze Requests");
  await expect(freezeButton).toBeVisible();
  await expect(freezeButton).toBeEnabled();
});

test("TC 301: Navigate to index page shows list of empty freezes", async ({ page, switcher }) => {
  await switcher.council(1, page);
  await goToFreezeIndex(page);

  for (const kind of ["SOFT_FREEZE", "HARD_FREEZE", "change-threshold", "UNFREEZE"]) {
    await expect(page.getByTestId(`${kind}-card`).getByText("No proposals found.")).toBeVisible();
  }
});

test("TC302: Navigate to freeze index. Shows all create buttons enabled", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);
  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").isEnabled();
  await page.getByTestId("hard-create-btn").isEnabled();
  await page.getByTestId("change-threshold-create-btn").isEnabled();
  await page.getByTestId("unfreeze-create-btn").isEnabled();
});

// soft freeze

test("TC303, TC304: click on create soft freeze button displays correct form.", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);

  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").click();

  await expect(page.getByRole("heading", { name: "Create Soft Freeze Proposal" })).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();

  await page.getByRole("button", { name: "Create" }).click();

  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 * 3600 * 24 * 7);
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent();
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent();
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
});

test("TC305: Create second soft when there is an active one, fails with proper message", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "SOFT_FREEZE");

  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").click();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Pending proposal already exists.")).toBeVisible();
});

test("TC313: Attempt to approve soft freeze by guardian, sign button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.guardian(1, page);
  await assertCannotSignProposal(page, "SOFT_FREEZE");
});

test("TC314: Attempt to approve soft freeze by zk foundation, sign button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.zkFoundation(page);
  await assertCannotSignProposal(page, "SOFT_FREEZE");
});

test("TC315: Attempt to approve soft freeze by visitor, sign button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await assertCannotSignProposal(page, "SOFT_FREEZE");
});

test("TC312: Approve soft freeze by security council member. Signature can be done, signature count increase by one.", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "SOFT_FREEZE");
  await goToFreezeDetailsPage(page, "SOFT_FREEZE");

  await withVoteIncrease(page, async () => {
    await approveFreeze(page, wallet);
  });

  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
});

test("TC316, TC317: Fulfill signature threshold for soft freeze -> broadcast -> correct tx status shown", async ({
  page,
  switcher,
  wallet,
}) => {
  await createFreeze(page, "SOFT_FREEZE");
  await applyApprovals(page, "SOFT_FREEZE", switcher, wallet, [1, 2, 3]);
  await broadcastAndCheckFreeze(page, wallet);
});

// hard freeze

test("TC306, TC307: create hard freeze popup is correct and works", async ({ page, switcher }) => {
  await switcher.council(1, page);

  await goToFreezeIndex(page);

  await page.getByTestId("hard-create-btn").click();

  await expect(page.getByRole("heading", { name: "Create Hard Freeze Proposal" })).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();

  await page.getByRole("button", { name: "Create" }).click();

  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 * 3600 * 24 * 7);
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent();
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent();
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
});

test("TC308: Create second hard freeze when there is an active one. Fails with proper message.", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "HARD_FREEZE");
  await goToFreezeIndex(page);

  await page.getByTestId("hard-create-btn").click();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Pending proposal already exists.")).toBeVisible();
});

test("TC321: Attempt hard freeze approve by guardian -> Approve button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.guardian(1, page);
  await assertCannotSignProposal(page, "HARD_FREEZE");
});

test("TC322: Attempt hard freeze approve by zk foundation -> Approve button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.zkFoundation(page);
  await assertCannotSignProposal(page, "HARD_FREEZE");
});

test("TC323: Attempt hard freeze approve by visitor -> Approve button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await assertCannotSignProposal(page, "HARD_FREEZE");
});

test("TC320: Hard freeze approve by security council -> updates state properly", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "HARD_FREEZE");
  await goToFreezeDetailsPage(page, "HARD_FREEZE");

  await withVoteIncrease(page, async () => {
    await approveFreeze(page, wallet);
  });
  await expect(approveButton(page)).toBeDisabled();
});

test("TC324, TC325: Fulfill signature threshold for hard freeze -> broadcast -> correct tx status shown", async ({
  page,
  switcher,
  wallet,
}) => {
  await createFreeze(page, "HARD_FREEZE");
  await applyApprovals(page, "HARD_FREEZE", switcher, wallet, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await broadcastAndCheckFreeze(page, wallet);
});

// Unfreeze

test("TC338, TC339: click create unfreze -> right data -> creates correct unfreeze proposal", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);

  await goToFreezeIndex(page);

  await page.getByTestId("unfreeze-create-btn").click();

  await expect(page.getByRole("heading", { name: "Create Unfreeze Proposal" })).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();

  await page.getByRole("button", { name: "Create" }).click();

  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 * 3600 * 24 * 7);
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent();
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent();
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
});

test("TC333: Attempt to approve unfreeze by guardian -> Sign button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.guardian(1, page);
  await assertCannotSignProposal(page, "UNFREEZE");
});

test("TC334: Attempt to approve unfreeze by zk foundation -> Sign button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.zkFoundation(page);
  await assertCannotSignProposal(page, "UNFREEZE");
});

test("TC335: Attempt to approve unfreeze by visitor -> Sign button disabled", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await assertCannotSignProposal(page, "UNFREEZE");
});

test("TC332: Approve change unfreeze by security council -> Updates state", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "UNFREEZE");
  await goToFreezeDetailsPage(page, "UNFREEZE");

  await withVoteIncrease(page, async () => {
    await approveFreeze(page, wallet);
  });

  await expect(approveButton(page)).toBeDisabled();
});

test("TC336, TC337: Freeze -> Gather unfreeze signatures -> Exec unfreeze tx -> tx is correctly created and displayed", async ({
  page,
  switcher,
  wallet,
}) => {
  await createFreeze(page, "SOFT_FREEZE");
  await applyApprovals(page, "SOFT_FREEZE", switcher, wallet, [1, 2, 3]);
  await page.getByRole("button", { name: "Execute freeze" }).click();
  await wallet.confirmTransaction();

  await createFreeze(page, "UNFREEZE");
  await applyApprovals(page, "UNFREEZE", switcher, wallet, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await broadcastAndCheckFreeze(page, wallet);
});

// change threshold

async function cannotSignChangeThreshold(page: Page) {
  await createChangeThreshold(page);

  await goToFreezeDetailsPage(page, "change-threshold");
  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", { name: "Approve" }).all();
  expect(approveButtons).toHaveLength(0);
}

test("TC309, TC311: create change threshold proposal shows right data and works", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);

  await goToFreezeIndex(page);

  await page.getByTestId("change-threshold-create-btn").click();

  await expect(page.getByText("Set Soft Freeze Threshold Proposals")).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();
  const thresholdInput = page.locator("[name='threshold']");
  await expect(thresholdInput).toBeEnabled();
  await thresholdInput.fill("2");

  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 * 3600 * 24 * 7);
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent();
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent();
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
});

test("TC310: Try to create a soft freeze threshold change with no threshold value -> Fails with proper error message", async ({
  page,
  switcher,
}) => {
  await switcher.guardian(1, page);
  await goToFreezeIndex(page);
  await page.getByTestId("change-threshold-create-btn").click();
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Number must be greater than or equal to 1")).toBeVisible();
});

test("TC327: Attempt to approve change threshold by guardian -> Approve button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.guardian(1, page);
  await cannotSignChangeThreshold(page);
});

test("TC328: Attempt to approve change threshold by zk foundation  -> Approve button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.zkFoundation(page);
  await cannotSignChangeThreshold(page);
});

test("TC328: Attempt to approve change threshold by visitor -> Approve button is not displayed", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await cannotSignChangeThreshold(page);
});

test("TC326: Approve change threshold by security council -> updates state", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createChangeThreshold(page);
  await goToFreezeDetailsPage(page, "change-threshold");

  await withVoteIncrease(page, async () => {
    await approveFreeze(page, wallet);
  });

  await expect(approveButton(page)).toBeDisabled();
});

test("TC330, TC331: Gather signatures for change signatures -> Exec tx -> Right state", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createChangeThreshold(page, 1);
  await goToFreezeDetailsPage(page, "change-threshold");

  await applyApprovals(page, "change-threshold", switcher, wallet, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await broadcastAndCheckFreeze(page, wallet);

  await createFreeze(page, "SOFT_FREEZE");
  await applyApprovals(page, "SOFT_FREEZE", switcher, wallet, [1]);
  await broadcastAndCheckFreeze(page, wallet);
});

test("TC318: Create soft freeze → change threshold. New threshold is reflected in soft freeze details", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createFreeze(page, "SOFT_FREEZE");

  await createChangeThreshold(page, 4);
  await applyApprovals(page, "change-threshold", switcher, wallet, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await broadcastAndCheckFreeze(page, wallet);

  await goToFreezeDetailsPage(page, "SOFT_FREEZE");
  const approvalCount = await page.getByTestId("signature-count").textContent();
  if (!approvalCount) {
    throw new Error("approval count should be visible");
  }
  const expectedAmount = approvalCount.split("/")[1];
  expect(expectedAmount).toEqual("4");
});
