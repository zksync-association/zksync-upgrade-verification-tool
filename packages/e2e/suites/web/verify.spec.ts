import { expect, test } from "@playwright/test";
import { getAddress } from "viem";
import { safeMessageHashes } from "../../../../apps/web/app/common/safe";
import { buildTypedData, governanceHashes } from "../../../../apps/web/app/common/typed-data";
import { COUNCIL, UPGRADE_ID, resetAll } from "./support";

// Reading and verifying, no wallet: every flow's page against the fork.

test.beforeEach(async () => {
  await resetAll();
});

test("landing shows the chain, the trust anchors and every flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("network-pill")).toContainText("Ethereum Mainnet");
  await expect(page.getByText("Connected to a local development node")).toBeVisible();
  await expect(page.getByTestId("flow-upgrades")).toContainText("1 in progress");
  await expect(page.getByTestId("flow-emergency")).toContainText("executed");
  await expect(page.getByText("ProtocolUpgradeHandler (pinned)")).toBeVisible();
});

test("an upgrade id opens its page with the decoded proposal and on-chain verdicts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Upgrade or emergency id").fill(UPGRADE_ID);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/proposals/${UPGRADE_ID}`));

  await expect(page.getByTestId("upgrade-state")).toHaveText("Waiting for approval");
  await expect(page.getByTestId("id-check")).toContainText("= id");
  await expect(page.getByTestId("call-list")).toContainText("upgrade(address,address)");

  const council = page.getByTestId("set-securityCouncil");
  await expect(council.getByTestId("signature-count")).toHaveText("7 / 4");
  await expect(council.getByTestId("threshold-met")).toBeVisible();
  await expect(council.locator('[data-status="valid"]')).toHaveCount(7);
  await expect(council.locator('[data-status="missing"]')).toHaveCount(1);
  await expect(council.getByTestId("simulation-ok")).toBeVisible();
  await expect(page.getByTestId("set-guardians").getByTestId("signature-count")).toHaveText(
    "0 / 5"
  );
});

test("a member row shows exactly the hashes that Safe's owners sign", async ({ page }) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const matterLabs = council.getByTestId("member-row").filter({ hasText: "Matter Labs" });
  await matterLabs.getByRole("button").first().click();

  const typedData = buildTypedData(
    "ApproveUpgradeSecurityCouncil",
    { name: "SecurityCouncil", version: "1", chainId: 1, verifyingContract: COUNCIL },
    { id: UPGRADE_ID }
  );
  const expected = safeMessageHashes(
    1,
    getAddress("0xc3Abc9f9AA75Be8341E831482cdA0125a7B1A23e"),
    governanceHashes(typedData).digest
  );
  await expect(matterLabs).toContainText(expected.domainHash);
  await expect(matterLabs).toContainText(expected.messageHash);
  await expect(matterLabs).toContainText(expected.safeMessageHash);
  await expect(matterLabs).toContainText("on-chain domainSeparator() equals the domain hash");
});

test("an executed emergency upgrade is rebuilt from its calldata and matches what members signed", async ({
  page,
}) => {
  await page.goto("/app/emergency");
  const executed = page.getByTestId("executed-emergencies");
  await expect(executed.getByTestId("emergency-row")).not.toHaveCount(0);
  await page.goto(
    "/app/emergency/0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e"
  );
  await expect(page.getByTestId("id-check")).toContainText("= id");
  await expect(page.getByText("Board's checks before execution")).toBeVisible();
  for (const role of ["securityCouncil", "guardians", "zkFoundation"]) {
    await expect(page.getByTestId(`set-${role}`).getByTestId("done-summary")).toContainText(
      "byte-for-byte identical"
    );
  }
});

test("the Guardian veto checks the L2 proposal against the signed id", async ({ page }) => {
  await page.goto("/app/l2-cancellations");
  await page.getByTestId("veto-row").first().click();
  await expect(page.getByTestId("id-check")).toContainText("hashL2Proposal recomputed here");
  await expect(page.getByTestId("set-veto").getByTestId("signature-count")).toContainText("/ 5");
});

test("the freeze page lists requests from Safe with their on-chain status", async ({ page }) => {
  await page.goto("/app/freeze");
  await expect(page.getByTestId("past-freezes").getByTestId("freeze-row").first()).toContainText(
    "Soft freeze"
  );
});
