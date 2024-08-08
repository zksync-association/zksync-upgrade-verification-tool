import { test, expect } from "../../helpers/dappwright.js";
test.beforeEach(async ({ page }, testInfo) => {
  await page.goto("http://localhost:3000");
});

test("should be able to connect", async ({ wallet, page }, testInfo) => {
  await expect(page.getByText("Emergency Upgrades")).toBeVisible();
  await expect(page.getByText("Standard Upgrades")).toBeVisible();
});

test("should be able to see an active standard proposal", async ({ wallet, page }, testInfo) => {
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
test.skip("should be able to login as visitor", async ({ wallet, page }, testInfo) => {
  await wallet.switchAccount(3);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Visitor");
});

// fix this upstream in dappwright
test.skip("should be able to login as sec council", async ({ wallet, page }, testInfo) => {
  await wallet.switchAccount(5);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Security Council");
});

// fix this upstream in dappwright
test.skip("should be able to login as guardian", async ({ wallet, page }, testInfo) => {
  await wallet.switchAccount(7);
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Guardian");
});

//TODO
test.skip("should be able to see standard proposals", async ({ wallet, page }) => {
  // goto standard proposals
  // click on standard proposal shown to see detail
  // check the amount of required signatures for sec council
  // check the amount of required signatures for guardians
  // check button active for sign proposal
  // Should see time left and other stuff
});

//TODO
test.skip("should be able to sign standard proposals", async ({ wallet, page }) => {
  // goto standard proposals
  // click on standard proposal shown to see detail
  // click on sign proposal
  // sign with with sec
  // check it's shown as signed
  // sign with guardian
  // check it's shown as signed
});

//TODO
test.skip("should be able to enact signed standard proposals", async ({ wallet, page }) => {
  // fake all the signatures somehow
  // click enact proposal
  // verify on chain that something is done
});

//TODO
test.skip("should be able to see empty emergency upgrades", async ({ wallet, page }) => {
  // goto emergency upgrades
  // check that there are no active upgrades
  // check that there are no inactive upgrades
});

//TODO
test.skip("should be able to add emergency upgrade", async ({ wallet, page }) => {
  // goto emergency upgrades
  // click on add emergency upgrade
  // fill the form
  // submit the form
  // check that the proposal is added
});

//TODO
test.skip("should be able to see detail of emergency upgrade", async ({ wallet, page }) => {
  // goto emergency upgrades
  // click on emergency upgrade
  // check the detail
  // check the amount of required signatures for sec council
  // check the amount of required signatures for guardians
  // check button active for sign proposal
  // Should see time left and other stuff
});

//TODO
test.skip("should be able to sign emergency upgrade", async ({ wallet, page }) => {
  // goto emergency upgrades
  // click on emergency upgrade
  // click on sign proposal
  // sign with with sec
  // check it's shown as signed
  // sign with guardian
  // check it's shown as signed
});

//TODO
test.skip("should change status of emergency proposals went enough signatures collected", async ({
  wallet,
  page,
}) => {
  // goto emergency upgrades
  // click on emergency upgrade
  // sign with enough signers so that it can be enacted
  // go back to list and check status is ready
});

//TODO
test.skip("should be able to enact signed emergency upgrade", async ({ wallet, page }) => {
  // fake all the signatures somehow
  // click enact proposal
  // verify on chain that something is done
});
