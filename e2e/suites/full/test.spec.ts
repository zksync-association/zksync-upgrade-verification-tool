import { test } from "../../helpers/dappwright.js";

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + 30000);
  await page.goto("http://localhost:3000");
});

test("should be able to connect", async ({ wallet, page }) => {
  await page.getByText("Connect Wallet").click();
  await page.getByText("Metamask").click();
  await wallet.approve();
  await wallet.confirmNetworkSwitch();

  //   const connectStatus = page.getByTestId("connect-status");
  //   expect(connectStatus).toHaveValue("connected");

  //   await page.click("#switch-network-button");

  //   const networkStatus = page.getByTestId("network-status");
  //   expect(networkStatus).toHaveValue("31337");
});
