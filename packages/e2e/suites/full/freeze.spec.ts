import { expect, test } from "../../helpers/dappwright.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("freeze button is listed and can be clicked", async ({page, switcher}) => {
  await switcher.council(1, page);
  const freezeButton = page.getByText("Freeze Requests");
  await expect(freezeButton).
  toBeVisible();
  await expect(freezeButton).toBeEnabled();
})

test("when no freeze request is created every category is empty", async ({page, switcher}) => {
  await switcher.council(1, page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  const elements = await page.getByText("No proposals found.").all();
  expect(elements.length).toEqual(4);

  await page.getByTestId("soft-create-btn").isEnabled()
  await page.getByTestId("hard-create-btn").isEnabled()
  await page.getByTestId("change-threshold-create-btn").isEnabled()
  await page.getByTestId("unfreeze-create-btn").isEnabled()
})

function compareExtractedTextWithDate(extractedText: string | null, expectedDate: Date) {
  const expectedNumber = Math.floor(expectedDate.valueOf() / 1000)
  const number = Number(extractedText?.replace("(", "").replace(")", ""))
  expect(number).toBeLessThan(expectedNumber + 10)
  expect(number).toBeGreaterThan(expectedNumber - 10)
}

test("sec council logs in, go to freeze, clicks on create soft freeze and creates with default values", async ({page, switcher}) => {
  await switcher.council(1, page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByTestId("soft-create-btn").click()

  await expect(page.getByText("Create Soft Freeze Proposal")).toBeVisible();
  await expect(page.getByText("Valid Until")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();

  await page.getByRole("button", { name: "Create" }).click();

  await page.waitForURL("**/app/freeze/*");

  const now = new Date();
  const oneWeekFromNow = new Date(Date.now() + 1000 *  3600 * 24 * 7)
  const validUntilText = await page.getByTestId("valid-until-timestamp").textContent()
  const proposedOnText = await page.getByTestId("proposed-on-timestamp").textContent()
  compareExtractedTextWithDate(validUntilText, oneWeekFromNow);
  compareExtractedTextWithDate(proposedOnText, now);
})

test.only("after create soft freeze a second one cannot be created", async ({page, switcher}) => {
  await switcher.council(1, page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByTestId("soft-create-btn").click()
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Pending proposal already exists.")).toBeVisible();
})

test.only("guardians cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.guardian(1, page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByText("Proposal 0").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", { name: "Approbe" }).all();
  expect(approveButtons).toHaveLength(0);
})

test.only("zk foundation cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.zkFoundation(page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByText("Proposal 0").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", { name: "Approbe" }).all();
  expect(approveButtons).toHaveLength(0);
})

test.only("visitor cannot sign a soft freeze", async ({page, switcher}) => {
  await switcher.visitor(page);

  await page.getByText("Freeze Requests").click();
  await page.waitForLoadState("networkidle");

  await page.getByText("Proposal 0").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("No role actions")).toBeVisible();
  const approveButtons = await page.getByRole("button", { name: "Approbe" }).all();
  expect(approveButtons).toHaveLength(0);
})