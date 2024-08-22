import { expect, test } from "../../helpers/dappwright.js";

test.beforeEach(async ({ page }, _testInfo) => {
  await page.goto("http://localhost:3000");
});

test("should be able to connect", async ({ page }, _testInfo) => {
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Standard Upgrades")).toBeVisible();
});

test("should be able to see an active standard proposal", async ({ page }, _testInfo) => {
  await page.getByText("Standard Upgrades").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("No active standard proposals found")).not.toBeVisible();
  await expect(page.getByText("No inactive standard proposals found")).toBeVisible();

  const activeProposal = page.getByRole("button", { name: /^0x/ }).first();
  await expect(activeProposal).toBeVisible();
  await expect(activeProposal).toBeEnabled();

  const activeProposalAgain = page.getByTestId(/^proposal-0x/);
  await expect(activeProposalAgain).toBeVisible();
  await expect(activeProposalAgain).toBeEnabled();
});

// fix this upstream in dappwright
test("should be able to login as visitor", async ({ wallet, page }, _testInfo) => {
  await wallet.switchAccount(4);
  await page.reload();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Visitor");
});

// fix this upstream in dappwright
test("should be able to login as sec council", async ({ wallet, page }, _testInfo) => {
  await wallet.switchAccount(1);
  await page.reload();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Security Council");
});

// fix this upstream in dappwright
test("should be able to login as guardian", async ({ wallet, page }, _testInfo) => {
  await wallet.switchAccount(2);
  await page.reload();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Guardian");
});

test("should be able to see standard proposals", async ({ page: importedPage }) => {
  const page = importedPage;
  await page.getByText("Standard Upgrades").click();
  await page.waitForLoadState("networkidle");

  const activeProposal = page.getByRole("button", { name: /^0x[a-fA-F0-9]{64}$/ }).first();
  await activeProposal.click();

  await page.waitForURL("**/proposals/**", { timeout: 1000 });
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Proposal Details")).toBeVisible();
  await expect(page.getByText("Current Version:")).toBeVisible();
  await expect(page.getByText("Proposed Version:")).toBeVisible();

  await expect(page.getByText("Security Council Approvals")).toBeVisible();
  await expect(page.getByText("Guardian Approvals")).toBeVisible();

  await expect(page.getByText(/LEGAL VETO PERIOD/)).toBeVisible();

  const approveButton = page.getByRole("button", { name: "Approve proposal" });
  await expect(approveButton).toBeVisible();
  await expect(approveButton).toBeEnabled();

  const executeSecurityCouncilButton = page.getByRole("button", {
    name: "Execute security council approval",
  });
  await expect(executeSecurityCouncilButton).toBeVisible();
  await expect(executeSecurityCouncilButton).toBeDisabled();

  const executeGuardianButton = page.getByRole("button", { name: "Execute guardian approval" });
  await expect(executeGuardianButton).toBeVisible();
  await expect(executeGuardianButton).toBeDisabled();

  const executeLegalVetoButton = page.getByRole("button", { name: "Execute legal veto extension" });
  await expect(executeLegalVetoButton).toBeVisible();
  await expect(executeLegalVetoButton).toBeDisabled();

  await expect(page.getByText(/day \d+ out of \d+/)).toBeVisible();
});

test("should be able to sign standard proposals", async ({ wallet, page }) => {
  await page.getByText("Standard Upgrades").click();
  await page.waitForLoadState("domcontentloaded");

  // This test is flakey because webapp fails to load non-upgrade proposal correctly on first go
  // this should be fixed in the webapp instead of here
  const activeProposal = page.getByRole("button", { name: /^0x[a-fA-F0-9]{64}$/ }).first();
  await activeProposal.click();

  const initialApprovals = await page.getByTestId("security-signatures").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0]);
  const approveButton = page.getByRole("button", { name: "Approve proposal" });
  approveButton.click();

  await wallet.sign();

  // To allow the count to update
  await page.waitForTimeout(5000);
  const updatedApprovals = await page.getByTestId("security-signatures").textContent();
  if (!updatedApprovals) {
    throw new Error("No Security Council Approvals found for updatedApprovals");
  }
  const updatedCount = Number.parseInt(updatedApprovals.split("/")[0]);

  expect(updatedCount).toBe(initialCount + 1);
  await expect(approveButton).toBeDisabled({ timeout: 5000 });
});

//TODO
test.skip("should be able to enact signed standard proposals", async () => {
  // fake all the signatures somehow
  // click enact proposal
  // verify on chain that something is done
});

//TODO
test.skip("should be able to see empty emergency upgrades", async () => {
  // goto emergency upgrades
  // check that there are no active upgrades
  // check that there are no inactive upgrades
});

test("should be able to add emergency upgrade", async ({ page }) => {
  // Investigate why have to click twice?
  await page.getByText("Emergency Upgrades").click({ clickCount: 2 });
  await page.waitForLoadState("networkidle");

  const addButton = page.getByTestId("new-emergency-proposal");
  await addButton.click();

  await page.getByLabel("Title").fill("Critical Security Fix");
  await page.getByText("Next").click();

  await page.getByLabel("Target Address").fill("0x72D8dd6EE7ce73D545B229127E72c8AA013F4a9e");
  await page.getByLabel("Calldata").fill("0xDEADBEEF");
  await page.getByText("Add call").click();
  await page.getByText("Next").click();

  await page.waitForLoadState("networkidle");

  await page.getByText("Submit").click();

  await page.waitForURL("**/app/emergency");
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Critical Security Fix")).toBeVisible();
});

test("should be able to see detail of emergency upgrade", async ({ page }) => {
  await page.getByText("Emergency Upgrades").click({ clickCount: 2 });
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "View" }).click();

  await page.waitForURL("**/emergency/**", { timeout: 1000 });

  await expect(page.getByText("Critical Security Fix")).toBeVisible();

  await expect(page.getByText("Security Council Approvals")).toBeVisible();
  await expect(page.getByText("Guardian Approvals")).toBeVisible();
  await expect(page.getByText("ZkFoundation approval")).toBeVisible();

  expect(await page.getByTestId("security-signatures").textContent()).toMatch(/\d\/9/);
  expect(await page.getByTestId("guardian-signatures").textContent()).toContain("0/5");
  expect(await page.getByTestId("zkfoundation-signatures").textContent()).toContain("0/1");

  const approveButton = page.getByRole("button", { name: "Approve" });
  await expect(approveButton).toBeVisible();
  await expect(approveButton).toBeEnabled();

  const executeUpgradeButton = page.getByRole("button", { name: "Execute upgrade" });
  await expect(executeUpgradeButton).toBeVisible();
  await expect(executeUpgradeButton).toBeDisabled();
});

test("should be able to sign emergency upgrade", async ({ wallet, page, context }) => {
  await page.getByText("Emergency Upgrades").click({ clickCount: 2 });
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "View" }).click();

  try {
    await page.waitForSelector("Proposal Details", { strict: false, timeout: 10000 });
  } catch {
    const locator = page.getByText("Go back to the home page");
    if (await locator.isVisible()) {
      page = await context.newPage();
      await page.goto("http://localhost:3000");
      await page.getByText("Emergency Upgrades").click({ clickCount: 2 });
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "View" }).click();
    }
  }
  const initialApprovals = await page.getByTestId("security-signatures").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0]);
  await page.getByRole("button", { name: "Approve" }).click();

  await wallet.sign();

  // To allow the count to update
  await page.waitForTimeout(5000);
  const updatedApprovals = await page.getByTestId("security-signatures").textContent();
  if (!updatedApprovals) {
    throw new Error("No Security Council Approvals found for updatedApprovals");
  }
  const updatedCount = Number.parseInt(updatedApprovals.split("/")[0]);

  expect(updatedCount).toBe(initialCount + 1);
});

//TODO
test.skip("should change status of emergency proposals went enough signatures collected", async () => {
  // goto emergency upgrades
  // click on emergency upgrade
  // sign with enough signers so that it can be enacted
  // go back to list and check status is ready
});

//TODO
test.skip("should be able to enact signed emergency upgrade", async () => {
  // fake all the signatures somehow
  // click enact proposal
  // verify on chain that something is done
});
