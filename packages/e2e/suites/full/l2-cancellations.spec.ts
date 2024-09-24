import { expect, type RoleSwitcher, test } from "./helpers/dappwright.js";
import type { Page } from "@playwright/test";
import type { Dappwright as Wallet } from "@tenkeylabs/dappwright";
import { guardianRange, repeatFor } from "./helpers/utils.js";

test.beforeEach(async ({ testApp }) => {
  await testApp.reset();
});

async function goToCancellationsIndex(page: Page) {
  await page.goto("/");
  await page.getByText("L2 Proposals Veto").click();
  await page.getByText("Active L2 Veto Proposals", { exact: true }).waitFor();
}

async function goToCreateCancellationPage(page: Page) {
  await goToCancellationsIndex(page);
  await page.getByTestId("new-cancellation-proposal").click();
  await page.getByText("1. Select an active proposal").waitFor();
}

async function goToCancellationDetail(page: Page) {
  await goToCancellationsIndex(page);
  await page.getByText("View").click();
  await page.getByText("Proposal Details").waitFor();
}

async function selectL2Proposal(page: Page, index: number) {
  const checkboxes = await page.locator('[name="proposalId"]').all();
  const checkbox = checkboxes[index];

  if (checkbox === undefined) {
    throw new Error("Expected checkbox to be on page.");
  }

  await checkbox.click();
}

async function createCancellation(page: Page, proposalIndex = 0) {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, proposalIndex);

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await page.getByText("Active L2 Veto Proposals", { exact: true }).waitFor({ state: "visible" });
}

async function withVoteIncrease(page: Page, fn: () => Promise<void>) {
  const initialApprovals = await page.getByTestId("approvals-count").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  await fn();

  await expect(page.getByTestId("approvals-count")).toHaveText(
    new RegExp(`${initialCount + 1}\/\\d`)
  );
}

// This code is copied from: https://github.com/TenKeyLabs/dappwright/blob/main/src/wallets/metamask/actions/util.ts#L3
// Thre eason is that we need to scroll before signed, and that's not included in the current version of dappright.
async function performPopupAction(
  page: Page,
  action: (popup: Page) => Promise<void>
): Promise<void> {
  const popup = await page.context().waitForEvent("page"); // Wait for the popup to show up

  await action(popup);
  if (!popup.isClosed()) await popup.waitForEvent("close");
}

// Our message has scroll. That is not included in dappwrights logic. That's why it's re implemented here.
async function signWithScroll(wallet: Wallet) {
  await performPopupAction(wallet.page, async (popup) => {
    await popup.bringToFront();
    await popup.reload();
    await popup.getByTestId("signature-request-scroll-button").click();
    await popup.getByRole("button", { name: "Sign" }).click();
  });
}

test("TC400: Go to / page -> l2 veto button is enabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("L2 Proposals Veto")).toBeEnabled();
});

test("TC401: Go to veto index page -> no vetos created.", async ({ page }) => {
  await page.goto("/");
  await page.getByText("L2 Proposals Veto").click();
  await page.getByText("Active L2 Veto Proposals").isVisible();
  await page.waitForLoadState("networkidle");

  const texts = await page.getByText("No veto proposals found.").all();
  expect(texts.length).toBe(2);
});

test("TC402: Create a veto, missing no proposal selected -> Submit button is disabled.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);

  await expect(page.getByRole("button", { name: "Create Veto Proposal" })).toBeDisabled();
});

test("TC403: Create a veto, proposal selected, empty l2 gas limit -> Submit errors.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, 0);
  const input = page.locator('[name="l2GasLimit"]');
  await input.clear();
  await input.blur();

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await expect(page.getByText("L2 gas limit is required")).toBeVisible();
});

test("TC404: Create a veto, proposal selected, empty l2 gas pubdata -> Submit button is disabled.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, 0);
  const input = page.locator('[name="l2GasPerPubdataByteLimit"]');
  await input.clear();
  await input.blur();

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await expect(page.getByText("L2 gas per pubdata byte limit is required")).toBeVisible();
});

test("TC405: Create a veto, proposal selected, empty l2 gas pubdata -> Submit button is disabled.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, 0);
  const refundRecipientInput = page.locator('[name="refundRecipient"]');
  await refundRecipientInput.clear();
  await refundRecipientInput.blur();

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await expect(page.getByText("Not a valid hex")).toBeVisible();
});

test("TC406: Create a veto, proposal selected, empty transaction mint value -> Submit button is disabled.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, 0);
  const input = page.locator('[name="txMintValue"]');
  await input.clear();
  await input.blur();

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await expect(page.getByText("Transaction mint value is required")).toBeVisible();
});

test("TC407: Create a veto, proposal selected, empty nonce -> Submit button is enabled.", async ({
  page,
}) => {
  await goToCreateCancellationPage(page);
  await selectL2Proposal(page, 0);
  await page.locator('[name="nonce"]').clear();

  await page.getByRole("button", { name: "Create Veto Proposal" }).click();
  await expect(page.getByText("Nonce is required")).toBeVisible();
});

test("TC408: Create a veto with correct data -> Redirects to index page. new veto is listed. Click on new veto displays right data.", async ({
  page,
}) => {
  await createCancellation(page, 0);

  await expect(page.getByText("Test ZkGovOpsGovernor proposal")).toBeVisible();
  const goToDetail = page.getByText("View");
  await expect(goToDetail).toBeVisible();
  await goToDetail.click();
  await page.getByText("Proposal Details").waitFor();

  await expect(page.getByText("GovOps Governor Proposal")).toBeVisible();
  await expect(page.getByText("Test ZkGovOpsGovernor proposal")).toBeVisible();
});

function approveButton(page: Page) {
  return page.getByTestId("approve-button");
}

test("TC409: Zk foundation goes to veto details page -> Approve button is not rendered", async ({
  page,
  switcher,
}) => {
  await switcher.zkFoundation(page);
  await createCancellation(page, 0);
  await goToCancellationDetail(page);

  await expect(page.getByText("No role actions")).toBeVisible();
  await expect(approveButton(page)).not.toBeAttached();
});

test("TC410: visitor goes to veto details page -> Approve button is not rendered", async ({
  page,
  switcher,
}) => {
  await switcher.visitor(page);
  await createCancellation(page, 0);
  await goToCancellationDetail(page);

  await expect(page.getByText("No role actions")).toBeVisible();
  await expect(approveButton(page)).not.toBeAttached();
});

test("TC411: council goes to veto details page -> Approve button is not rendered", async ({
  page,
  switcher,
}) => {
  await switcher.council(1, page);
  await createCancellation(page, 0);
  await goToCancellationDetail(page);

  await expect(page.getByText("No role actions")).toBeVisible();
  await expect(approveButton(page)).not.toBeAttached();
});

test("TC412: Guardian goes to veto details page -> Approvals count increased in 1. Button disabled after approve.", async ({
  page,
  switcher,
  wallet,
}) => {
  await switcher.guardian(1, page);
  await createCancellation(page, 0);
  await goToCancellationDetail(page);

  await withVoteIncrease(page, async () => {
    await approveButton(page).click();
    await signWithScroll(wallet);
  });

  await expect(approveButton(page)).toBeDisabled();
});

async function createAndApproveCancellation(
  page: Page,
  switcher: RoleSwitcher,
  wallet: Wallet,
  index: number
) {
  await switcher.guardian(1, page);
  await createCancellation(page, index);
  await goToCancellationDetail(page);

  await repeatFor(guardianRange(1, 5), async (n) => {
    await switcher.guardian(n, page);
    await approveButton(page).click();
    await signWithScroll(wallet);
  });
}

test("TC413: Approvals gathered -> Broadcast button enabled for every rol", async ({
  page,
  switcher,
  wallet,
}) => {
  await createAndApproveCancellation(page, switcher, wallet, 0);

  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Execute Veto" })).toBeEnabled();

  await switcher.council(1, page);
  await goToCancellationDetail(page);
  await expect(page.getByRole("button", { name: "Execute Veto" })).toBeEnabled();

  await switcher.visitor(page);
  await goToCancellationDetail(page);
  await expect(page.getByRole("button", { name: "Execute Veto" })).toBeEnabled();

  await switcher.zkFoundation(page);
  await goToCancellationDetail(page);
  await expect(page.getByRole("button", { name: "Execute Veto" })).toBeEnabled();
});

test("TC414: Broadcast tx -> Redirects to /transactions. Shows correct tx data. Transaction is created with right eth value.", async ({
  page,
  switcher,
  wallet,
}) => {
  await createAndApproveCancellation(page, switcher, wallet, 0);

  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Execute Veto" }).click();
  await wallet.confirmTransaction();

  await expect(page.getByText("Transaction successful")).toBeVisible();
});

test("TC415: Create govops proposal -> Creates with proper data.", async ({ page }) => {
  await createCancellation(page, 0);
  await goToCancellationDetail(page);

  await expect(page.getByText("GovOps Governor Proposal", { exact: true })).toBeVisible();
  await expect(page.getByText("Test ZkGovOpsGovernor proposal", { exact: true })).toBeVisible();
});

test("TC416: Create token proposal -> Creates with proper data.", async ({ page }) => {
  await createCancellation(page, 1);
  await goToCancellationDetail(page);

  await expect(page.getByText("Token Governor Proposal", { exact: true })).toBeVisible();
  await expect(page.getByText("Test ZkTokenGovernor proposal", { exact: true })).toBeVisible();
});
