import { test, expect } from "../../helpers/dappwright.js";
import { TestApp } from "./helpers/test-app.js";

const testApp = new TestApp();

test.beforeEach(async ({ page }) => {
  await testApp.reset();
  await page.goto("/");
});

test("should be able to connect", async ({ page }) => {
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Standard Upgrades")).toBeVisible();
});

test("should be able to see an active standard proposal", async ({ page }) => {
  await page.getByText("Standard Upgrades").click();

  await expect(page.getByText("No active standard proposals found")).not.toBeVisible();
  await expect(page.getByText("No inactive standard proposals found")).toBeVisible();

  const activeProposal = page.getByRole("button", { name: /^0x/ }).first();
  await expect(activeProposal).toBeVisible();
  await expect(activeProposal).toBeEnabled();
});

test("should be able to login as visitor", async ({ switcher, page }) => {
  await switcher.visitor(page);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Visitor");
});

test("should be able to login as sec council", async ({ switcher, page }) => {
  await switcher.council(1, page);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Security Council");
});

test("should be able to login as guardian", async ({ switcher, page }) => {
  await switcher.guardian(1, page);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Guardian");
});

test("can login as zk association", async ({ switcher, page }) => {
  await switcher.zkFoundation(page);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("ZkSync Foundation");
});

test("should be able to see standard proposals", async ({ switcher, page }) => {
  await switcher.council(1, page);
  await page.getByText("Standard Upgrades").click();

  const activeProposal = page.getByRole("button", { name: /^0x[a-fA-F0-9]{64}$/ }).first();
  await activeProposal.click();

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

test("should be able to sign standard proposals", async ({ switcher, wallet, page }) => {
  await switcher.council(1, page);
  await page.getByText("Standard Upgrades").click();

  const activeProposal = page.getByRole("button", { name: /^0x[a-fA-F0-9]{64}$/ }).first();
  await activeProposal.click();

  const initialApprovals = await page.getByTestId("council-signature-count").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  const approveButton = page.getByRole("button", { name: "Approve proposal" });
  await approveButton.click();

  await wallet.sign();

  await expect(page.getByTestId("council-signature-count")).toHaveText(`${initialCount + 1}/6`);
  await expect(approveButton).toBeDisabled();
});

// //TODO
// test.skip("should be able to enact signed standard proposals", async () => {
//   // fake all the signatures somehow
//   // click enact proposal
//   // verify on chain that something is done
// });

// //TODO
// test.skip("should be able to see empty emergency upgrades", async () => {
//   // goto emergency upgrades
//   // check that there are no active upgrades
//   // check that there are no inactive upgrades
// });

test("should be able to add emergency upgrade", async ({ switcher, page }) => {
  await switcher.council(1, page);
  await page.getByText("Emergency Upgrades").click();

  const addButton = page.getByTestId("new-emergency-proposal");
  await addButton.click();

  // FIXME: remove when we move away from react-hook-form
  await page.waitForTimeout(500);

  await page.getByLabel("Title").fill("Critical Security Fix");
  await page.getByText("Next").click();

  await page.getByLabel("Target Address").fill("0x72D8dd6EE7ce73D545B229127E72c8AA013F4a9e");
  await page.getByLabel("Calldata").fill("0xDEADBEEF");
  await page.getByText("Add call").click();
  await page.getByText("Next").click();

  await page.getByText("Submit").click();

  await page.waitForURL("**/app/emergency");

  await expect(page.getByText("Critical Security Fix")).toBeVisible();
});

test("should be able to see detail of emergency upgrade", async ({ page }) => {
  await page.getByText("Emergency Upgrades").click();

  await page.getByRole("button", { name: "View" }).click();

  await expect(page.getByText("Critical Security Fix")).toBeVisible();

  await expect(page.getByText("Security Council Approvals")).toBeVisible();
  await expect(page.getByText("Guardian Approvals")).toBeVisible();
  await expect(page.getByText("ZkFoundation approval")).toBeVisible();

  await expect(page.getByTestId("security-signatures")).toHaveText(/\d\/9/);
  await expect(page.getByTestId("guardian-signatures")).toHaveText("0/5");
  await expect(page.getByTestId("zkfoundation-signatures")).toHaveText("0/1");

  const approveButton = page.getByRole("button", { name: "Approve" });
  await expect(approveButton).toBeEnabled();

  const executeUpgradeButton = page.getByRole("button", { name: "Execute upgrade" });
  await expect(executeUpgradeButton).toBeDisabled();
});

test("should be able to sign emergency upgrade", async ({ wallet, page }) => {
  await page.getByText("Emergency Upgrades").click();
  await page.getByRole("button", { name: "View" }).click();

  const initialApprovals = await page.getByTestId("security-signatures").textContent();
  if (!initialApprovals) {
    throw new Error("No Security Council Approvals found for initialApprovals");
  }
  const initialCount = Number.parseInt(initialApprovals.split("/")[0] ?? "");

  await page.getByRole("button", { name: "Approve" }).click();
  await wallet.sign();

  await expect(page.getByTestId("security-signatures")).toHaveText(`${initialCount + 1}/9`);
});

// // //TODO
// // test.skip("should change status of emergency proposals went enough signatures collected", async () => {
// //   // goto emergency upgrades
// //   // click on emergency upgrade
// //   // sign with enough signers so that it can be enacted
// //   // go back to list and check status is ready
// // });

// // //TODO
// // test.skip("should be able to enact signed emergency upgrade", async () => {
// //   // fake all the signatures somehow
// //   // click enact proposal
// //   // verify on chain that something is done
// // });
