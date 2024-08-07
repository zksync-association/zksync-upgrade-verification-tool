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

// add test for login as visitor
test("should be able to login as visitor", async ({ wallet, page }, testInfo) => {
  await page.getByTestId("connected-button").click();
  await page.getByText("Disconnect").click();
  await wallet.importPK("0xa93661466cdbbbad85f7cf419a45a00e55012de9") // account #19

  const connectButton = page.getByText("Connect Wallet")
  await expect(connectButton).toBeVisible();
  await connectButton.click();

  await page.getByText("Metamask").click();
  await wallet.approve();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Visitor");
}
);

test("should be able to login as sec council", async ({ wallet, page }, testInfo) => {
  await page.getByTestId("connected-button").click();
  await page.getByText("Disconnect").click();
  await wallet.switchAccount(0)

  const connectButton = page.getByText("Connect Wallet")
  await expect(connectButton).toBeVisible();
  await connectButton.click();

  await page.getByText("Metamask").click();
  await wallet.approve();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Security Council");
}
);

test("should be able to login as guardian", async ({ wallet, page }, testInfo) => {
  await page.getByTestId("connected-button").click();
  await page.getByText("Disconnect").click();
  await wallet.switchAccount(7)

  const connectButton = page.getByText("Connect Wallet")
  await expect(connectButton).toBeVisible();
  await connectButton.click();

  await page.getByText("Metamask").click();
  await wallet.approve();
  const userRole = page.getByTestId("user-role");
  await expect(userRole).toBeVisible();
  await expect(userRole).toHaveText("Guardian");
}
);

// add test for standard proposal navigation

// add test for standard signing

// add test to enact standard proposal

// add test for empty emergency upgrades

// add test to add emergency upgrade

// add test to detail emergency upgrade

// add test to sign emergency upgrade

// add test to enact emergency upgrade
