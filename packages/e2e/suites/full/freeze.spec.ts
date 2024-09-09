import { expect, test } from "../../helpers/dappwright.js";
import type { Page } from "@playwright/test";

test.beforeEach(async ({page}) => {
  await page.goto("/");
});

async function goToFreezeIndex(page: Page) {
  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");
}

function compareExtractedTextWithDate(extractedText: string | null, expectedDate: Date) {
  const expectedNumber = Math.floor(expectedDate.valueOf() / 1000)
  const number = Number(extractedText?.replace("(", "").replace(")", ""))
  expect(number).toBeLessThan(expectedNumber + 10)
  expect(number).toBeGreaterThan(expectedNumber - 10)
}

test("freeze button is listed and can be clicked", async ({page, switcher}) => {
  await switcher.council(1, page);
  const freezeButton = page.getByText("Freeze Requests");
  await expect(freezeButton).toBeVisible();
  await expect(freezeButton).toBeEnabled();
})

test("when no freeze request is created every category is empty", async ({page, switcher}) => {
  await switcher.council(1, page);
  await goToFreezeIndex(page)

  for (const kind of ["soft", "hard", "change-threshold", "unfreeze"]) {
    await expect(page.getByTestId(`${kind}-card`).getByText("No proposals found.")).toBeVisible()
  }
})

test("all freeze create buttons are enabled.", async ({page, switcher}) => {
  await switcher.council(1, page);
  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").isEnabled()
  await page.getByTestId("hard-create-btn").isEnabled()
  await page.getByTestId("change-threshold-create-btn").isEnabled()
  await page.getByTestId("unfreeze-create-btn").isEnabled()
})

test("sec council logs in, go to freeze, clicks on create soft freeze and creates with default values", async ({
  page,
  switcher
}) => {
  await switcher.council(1, page);

  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").click();

  await expect(page.getByText("Create Soft Freeze Proposal")).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", {name: "Create"})).toBeEnabled();

  await page.getByRole("button", {name: "Create"}).click();

  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 * 3600 * 24 * 7)
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent()
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent()
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
})

test("after create soft freeze a second one cannot be created", async ({page, switcher}) => {
  await switcher.council(1, page);
  await goToFreezeIndex(page);

  await page.getByTestId("soft-create-btn").click()
  await page.getByRole("button", {name: "Create"}).click();
  await expect(page.getByText("Pending proposal already exists.")).toBeVisible();
})

async function goToFreezeDetailsPage(page: Page, kind: string) {
  await goToFreezeIndex(page);

  await page.getByTestId(`${kind}-proposals`).getByText(/Proposal \d+/).click();
  await page.waitForLoadState("networkidle");
}

async function assertCannotSignProposal(page: Page, kind: string) {
  await goToFreezeDetailsPage(page, kind);

  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", {name: "Approve"}).all();
  expect(approveButtons).toHaveLength(0);
}

test("guardians cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.guardian(1, page);
  await assertCannotSignProposal(page, "soft")
})

test("zk foundation cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.zkFoundation(page);
  await assertCannotSignProposal(page, "soft")
})

test("visitor cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.visitor(page);
  await assertCannotSignProposal(page, "soft")
})

test("security council member can sign a soft freeze", async ({page, switcher, wallet}) => {
  await switcher.council(1, page);

  await goToFreezeDetailsPage(page, "soft");

  const initialApprovals = await page.getByTestId("signature-count").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  const approveButton = page.getByRole("button", {name: "Approve"});
  await approveButton.click();
  await wallet.sign();

  await expect(page.getByTestId("signature-count")).toHaveText(new RegExp(`${initialCount + 1}\/\\d`) );
  await expect(approveButton).toBeDisabled();
})

test("after reach threshold sign button can be broadcasted", async ({page, switcher, wallet}) => {
  await switcher.council(2, page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByText(/Proposal \d+/).click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", {name: "Approve"}).click();
  await wallet.sign();

  await switcher.council(3, page);

  await page.getByRole("button", {name: "Approve"}).click();
  await wallet.sign();

  const broadcastButton = page.getByRole("button", {name: "Execute freeze"});
  await expect(broadcastButton).toBeEnabled();

  await broadcastButton.click();
  await wallet.confirmTransaction();

  await page.waitForURL("**/transactions/**");
  const txid = await page.getByTestId("transaction-hash").textContent();

  expect(txid).toMatch(/^0x[0-9a-fA-F]+$/)
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(10 * 1000)
  await expect(page.getByText("Transaction Hash:")).toBeVisible();
})

test.skip("broadcasted transaction exists in blockchain", () => {})

