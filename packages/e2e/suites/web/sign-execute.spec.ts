import { expect, test } from "@playwright/test";
import type { Hex } from "viem";
import {
  COUNCIL,
  UNSIGNED_MEMBER,
  UPGRADE_ID,
  buildTypedData,
  chain,
  refreshApp,
  resetAll,
  signInSafe,
} from "./support";

// Members sign in their own Safe (over WalletConnect, which a test can't drive; what the app asks
// the wallet to sign is covered by test/unit/signature-set.test.tsx). The app never receives or
// stores the signature: it reappears through Safe's API and is verified on-chain. Executing sends
// the calldata the page shows.

test.beforeEach(async () => {
  await resetAll();
});

test("a signature filed in a member's Safe shows up and the contract accepts it", async ({
  page,
}) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const openZeppelin = council.getByTestId("member-row").filter({ hasText: "OpenZeppelin" });
  await expect(openZeppelin).toHaveAttribute("data-status", "missing");

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
  await expect(council.getByTestId("signature-count")).toHaveText("8 signatures · 4 required");
  await expect(openZeppelin).toHaveAttribute("data-status", "valid");
});

test("anyone can execute the approval with the calldata the page builds", async ({ page }) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  // Anyone can send it: Your signature's row for the group at its threshold, then its review.
  await page
    .getByTestId("your-signature")
    .getByTestId("send-row-securityCouncil")
    .getByTestId("review-send")
    .click();
  const calldata = (await page.getByRole("dialog").getByTestId("calldata").innerText()).trim();
  const receipt = await chain.sendAs(
    "0x00000000000000000000000000000000000c0FfE",
    COUNCIL,
    calldata as Hex
  );
  expect(receipt.status).toBe("success");

  await refreshApp();
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  await expect(page.getByTestId("upgrade-state")).toHaveText("Execution pending");
  // Done: the approval transaction; nothing it carried differs from Safe's copies.
  await expect(council.getByTestId("done-summary")).toContainText("In 0x");
  await expect(council.getByTestId("used-differ")).toHaveCount(0);
});
