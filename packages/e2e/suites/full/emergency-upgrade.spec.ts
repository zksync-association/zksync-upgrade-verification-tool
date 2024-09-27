import { expect, type RoleSwitcher, test } from "./helpers/dappwright.js";
import type { Page } from "@playwright/test";
import type { Dappwright, Dappwright as Wallet } from "@tenkeylabs/dappwright";
import { councilRange, guardianRange, repeatFor } from "./helpers/utils.js";
import {
  createEmergencyProposal,
  goToActiveEmergencyProposal,
  goToCreateEmergencyProposal,
  goToEmergencyIndex,
} from "./helpers/common/emergency-upgrade.js";

test.beforeEach(async ({ testApp }) => {
  await testApp.reset();
});

function approveButton(page: Page) {
  return page.getByTestId("approve-button");
}

async function approveEmergencyProposal(page: Page, wallet: Wallet) {
  const button = approveButton(page);
  await button.click();
  await wallet.sign();
}

async function extractApprovalCount(page: Page, testId: string) {
  const initialApprovals = await page.getByTestId(testId).textContent();
  if (!initialApprovals) {
    throw new Error(`No approval count found with id: ${testId}`);
  }
  return initialApprovals;
}

async function withVoteIncrease(page: Page, testId: string, fn: () => Promise<void>) {
  const initialApprovals = await extractApprovalCount(page, testId);
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  await fn();

  await expect(page.getByTestId(testId)).toHaveText(new RegExp(`${initialCount + 1}\/\\d`));
}

test("TC213: Go to / -> Emergency upgrade button is enabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Emergency Upgrades")).toBeEnabled();
});

test("TC201: Go to index page, no proposals -> active and inactive emergency upgrades empty", async ({
  page,
}) => {
  await goToEmergencyIndex(page);

  await expect(page.getByText("No active emergency proposals found.")).toBeVisible();
  await expect(page.getByText("No inactive emergency proposals found.")).toBeVisible();
});

test("TC202: Create a valid emergency proposal -> List it into active proposals", async ({
  page,
}) => {
  await createEmergencyProposal(page, "TC202");
  await goToEmergencyIndex(page);
  await page.getByText("title").waitFor();
  const rows = await page.locator("tbody tr").all();
  expect(rows.length).toBe(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Missing row with created upgraded.");
  }
  await expect(row.getByText("TC202")).toBeVisible();
  await expect(row.getByText("ACTIVE")).toBeVisible();
  await expect(row.getByText("View")).toBeVisible();
});

test("TC203: Try to create emergency upgrade with invalid calldata -> Cannot be done. Shows error message.", async ({
  page,
}) => {
  await goToCreateEmergencyProposal(page);

  await page.getByLabel("Title").fill("TC203");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Target Address").fill("0x6fe12efa79da1426af9c811b80edca74556c5a0e");
  await page.getByLabel("Calldata").fill("0xffffffff"); // Invalid calldata

  await page.getByRole("button", { name: "Add call" }).click();
  await page.getByRole("button", { name: "Next" }).isEnabled();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Error validating transactions").isVisible();
  await page.getByRole("button", { name: "Submit" }).isDisabled();
});

test("TC204: Security council member approves emergency proposal -> Council count +1, approve button disabled", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.council(1, page);
  await createEmergencyProposal(page);

  await withVoteIncrease(page, "security-signatures", async () => {
    await approveEmergencyProposal(page, wallet);
  });

  await expect(approveButton(page)).toBeDisabled();

  expect(await extractApprovalCount(page, "guardian-signatures")).toEqual("0/5");
  expect(await extractApprovalCount(page, "zkfoundation-signatures")).toEqual("0/1");
});

test("TC205: Guardian member approves emergency proposal -> guardian +1, approve button disabled", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.guardian(1, page);
  await createEmergencyProposal(page);

  await withVoteIncrease(page, "guardian-signatures", async () => {
    await approveEmergencyProposal(page, wallet);
  });

  await expect(approveButton(page)).toBeDisabled();

  expect(await extractApprovalCount(page, "security-signatures")).toEqual("0/9");
  expect(await extractApprovalCount(page, "zkfoundation-signatures")).toEqual("0/1");
});

test("TC206: ZkFoundation approves emergency proposal -> zkfoundation +1, approve button disabled", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.zkFoundation(page);
  await createEmergencyProposal(page);

  await withVoteIncrease(page, "zkfoundation-signatures", async () => {
    await approveEmergencyProposal(page, wallet);
  });

  await expect(approveButton(page)).toBeDisabled();

  expect(await extractApprovalCount(page, "security-signatures")).toEqual("0/9");
  expect(await extractApprovalCount(page, "guardian-signatures")).toEqual("0/5");
});

test("TC214: Visitor goes to detail page -> Approve button is not shown", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await createEmergencyProposal(page);

  await expect(page.getByText("No signing actions")).toBeVisible();
  await expect(page.getByText("Approve emergency upgrade")).not.toBeVisible();
  await expect(approveButton(page)).not.toBeAttached();
});

async function fillEmergencyUpgrade(page: Page, wallet: Dappwright, switcher: RoleSwitcher) {
  await switcher.council(1);
  await createEmergencyProposal(page);

  await repeatFor(councilRange(1, 9), async (n) => {
    await switcher.council(n, page);
    await approveEmergencyProposal(page, wallet);
  });

  await switcher.guardian(1, page);
  await goToActiveEmergencyProposal(page);
  await repeatFor(guardianRange(1, 5), async (n) => {
    await switcher.guardian(n, page);
    await approveEmergencyProposal(page, wallet);
  });

  await switcher.zkFoundation(page);
  await goToActiveEmergencyProposal(page);
  await approveEmergencyProposal(page, wallet);
}

test("TC207, TC208, TC209, TC210: Filled emergency proposal -> Every rol can see the broadcast button enabled", async ({
  page,
  wallet,
  switcher,
}) => {
  await fillEmergencyUpgrade(page, wallet, switcher);

  await switcher.council(1, page);
  await goToActiveEmergencyProposal(page);
  await expect(page.getByRole("button", { name: "Execute upgrade" })).toBeEnabled();

  await switcher.guardian(1, page);
  await goToActiveEmergencyProposal(page);
  await expect(page.getByRole("button", { name: "Execute upgrade" })).toBeEnabled();

  await switcher.zkFoundation(page);
  await goToActiveEmergencyProposal(page);
  await expect(page.getByRole("button", { name: "Execute upgrade" })).toBeEnabled();

  await switcher.visitor(page);
  await goToActiveEmergencyProposal(page);
  await expect(page.getByRole("button", { name: "Execute upgrade" })).toBeEnabled();
});

test("TC211, TC212, TC213: Broadcast emergency proposal -> Shows right txid -> Is shown as inactive -> No more actions available", async ({
  page,
  wallet,
  switcher,
}) => {
  await fillEmergencyUpgrade(page, wallet, switcher);

  await switcher.council(1, page);
  await goToActiveEmergencyProposal(page);
  await page.getByRole("button", { name: "Execute upgrade" }).click();
  await wallet.confirmTransaction();
  await page.waitForURL("**/transactions/**");

  await goToEmergencyIndex(page);

  const inactiveCard = page.getByTestId("inactive-proposals-card");
  await inactiveCard.getByText("Emergency test!!").isVisible();
  await inactiveCard.getByText("BROADCAST").isVisible();
  await inactiveCard.getByText("View").click();

  await page.getByText("Proposal Details").isVisible();
  await page.getByRole("button", { name: "Approve emergency upgrade" }).isDisabled();
  await page.getByRole("button", { name: "Execute upgrade" }).isDisabled();
});
