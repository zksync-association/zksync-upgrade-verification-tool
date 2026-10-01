import { expect, test } from "@playwright/test";
import {
  ANVIL_URL,
  APP_URL,
  COUNCIL,
  UNSIGNED_MEMBER,
  UPGRADE_ID,
  buildTypedData,
  connectWallet,
  installWallet,
  refreshApp,
  resetAll,
  signInSafe,
} from "./support";

// Signing goes to the member's Safe (here an injected test wallet standing in for WalletConnect →
// Safe{Wallet}); the app never receives or stores the signature. It reappears through Safe's API
// and is verified on-chain. Executing sends the calldata the page shows.

test.beforeEach(async () => {
  await resetAll();
});

test("a member Safe signs: the request carries exactly the displayed typed data", async ({
  page,
}) => {
  await installWallet(page, UNSIGNED_MEMBER);
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  await connectWallet(page);
  await expect(page.getByTestId("connected-account")).toContainText("Security Council");

  const council = page.getByTestId("set-securityCouncil");
  await council.getByTestId("sign-button").click();
  await expect(page.getByRole("dialog")).toContainText("Your hardware wallet should show");
  // The browser talks only to this app, the wallet (here: the fork) and Google Fonts.
  const allowed = new Set([
    new URL(APP_URL).host,
    new URL(ANVIL_URL).host,
    "fonts.googleapis.com",
    "fonts.gstatic.com",
  ]);
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.protocol.startsWith("http") && !allowed.has(url.host)) elsewhere.push(r.url());
  });
  await page.getByTestId("confirm-sign").click();

  const requests = await page.evaluate(() =>
    window.__walletRequests.filter((r) => r.method === "eth_signTypedData_v4")
  );
  expect(requests).toHaveLength(1);
  const [address, json] = requests[0]?.params as [string, string];
  expect(address.toLowerCase()).toBe(UNSIGNED_MEMBER.toLowerCase());
  const signed = JSON.parse(json);
  expect(signed.primaryType).toBe("ApproveUpgradeSecurityCouncil");
  expect(signed.domain).toMatchObject({ name: "SecurityCouncil", version: "1", chainId: 1 });
  expect(signed.domain.verifyingContract.toLowerCase()).toBe(COUNCIL.toLowerCase());
  expect(signed.message.id).toBe(UPGRADE_ID);
  // The signature goes to the Safe (the wallet), nowhere else.
  expect(elsewhere).toEqual([]);

  // Once the Safe files the signature, the page picks it up and the contract accepts it.
  await signInSafe(
    UNSIGNED_MEMBER,
    buildTypedData(
      "ApproveUpgradeSecurityCouncil",
      { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
      { id: UPGRADE_ID }
    )
  );
  await refreshApp();
  await page.reload();
  await expect(council.getByTestId("signature-count")).toHaveText("8 / 4");
  await expect(
    council.getByTestId("member-row").filter({ hasText: "OpenZeppelin" })
  ).toHaveAttribute("data-status", "valid");
});

test("anyone can execute the approval with the calldata the page builds", async ({ page }) => {
  await installWallet(
    page,
    "0x00000000000000000000000000000000000c0FfE".toLowerCase() as `0x${string}`
  );
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  await connectWallet(page);
  await expect(page.getByTestId("connected-account")).toContainText("not a member");

  const council = page.getByTestId("set-securityCouncil");
  await council.getByRole("button", { name: "Send transaction" }).click();
  await expect(page).toHaveURL(/\/app\/transactions\/0x[0-9a-f]{64}/);
  await expect(page.getByText(/Succeeded in block/)).toBeVisible();

  await refreshApp();
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  await expect(page.getByTestId("upgrade-state")).toHaveText("Execution pending");
  await expect(council.getByTestId("done-summary")).toContainText("7 of 7");
});
