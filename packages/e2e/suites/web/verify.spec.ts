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
  await page.getByText("Data sources & verification").click();
  await expect(page.getByText("ProtocolUpgradeHandler (pinned)")).toBeVisible();
});

test("an upgrade id opens its page with the decoded proposal and on-chain verdicts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Open a proposal by ID").fill(UPGRADE_ID);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/proposals/${UPGRADE_ID}`));

  await expect(page.getByTestId("upgrade-state")).toHaveText("Waiting for approval");
  await expect(page.getByTestId("id-check")).toContainText("Upgrade content verified");
  const calls = page.getByTestId("call-list");
  await expect(calls.getByTestId("call")).toContainText("upgrade(..)");
  await calls.getByRole("button", { name: "Raw", exact: true }).click();
  // Raw: the calls as JSON; upgrade(address,address) is selector 0x99a88ec4.
  await expect(calls.getByTestId("calls-json")).toContainText('"data": "0x99a88ec4');

  const council = page.getByTestId("set-securityCouncil");
  await expect(council.getByTestId("signature-count")).toHaveText("7 signatures · 4 required");
  await expect(council.getByTestId("threshold-met")).toBeVisible();
  await expect(council.locator('[data-status="valid"]')).toHaveCount(7);
  await expect(council.locator('[data-status="missing"]')).toHaveCount(1);
  // The approval it makes is in Your signature, simulated in its review.
  await page
    .getByTestId("your-signature")
    .getByTestId("send-row-securityCouncil")
    .getByTestId("review-send")
    .click();
  await expect(page.getByRole("dialog").getByTestId("simulation-ok")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("set-guardians").getByTestId("signature-count")).toHaveText(
    "0 signatures · 5 required"
  );
});

test("a member row shows exactly the hashes that Safe's owners sign", async ({ page }) => {
  await page.goto(`/app/proposals/${UPGRADE_ID}`);
  const council = page.getByTestId("set-securityCouncil");
  const matterLabs = council.getByTestId("member-row").filter({ hasText: "Matter Labs" });
  await matterLabs.getByRole("button").first().click();
  // Its Safe, owners and hashes open under the members' row.
  const detail = council.getByTestId("member-detail");
  await expect(detail).toContainText("Matter Labs");

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
  await expect(detail).toContainText(expected.domainHash);
  await expect(detail).toContainText(expected.messageHash);
  await expect(detail).toContainText(expected.safeMessageHash);
  await expect(detail.getByTestId("domain-separator-differs")).toHaveCount(0);
});

test("an executed emergency upgrade is rebuilt from its calldata and matches what members signed", async ({
  page,
}) => {
  // The fork's execution is older than the list's recent window: the full history has it.
  await page.goto("/app/emergency?history=all");
  const executed = page.getByTestId("executed-emergencies");
  await expect(executed.getByTestId("emergency-row")).not.toHaveCount(0);
  await page.goto(
    "/app/emergency/0xb1660380be18f4cf30cb1a253d3e91da3e584ca7ae82d7d6fd9675a722d6da5e"
  );
  await expect(page.getByTestId("id-check")).toContainText("= id");
  await expect(page.getByText("Board's checks before execution")).toBeVisible();
  for (const role of ["securityCouncil", "guardians", "zkFoundation"]) {
    await expect(page.getByTestId(`set-${role}`).getByTestId("done-summary")).toContainText(
      "In 0x"
    );
    await expect(page.getByTestId(`set-${role}`).getByTestId("used-differ")).toHaveCount(0);
  }
});

test("the Guardian veto checks the L2 proposal against the signed id", async ({ page }) => {
  await page.goto("/app/l2-cancellations");
  await page.getByTestId("veto-row").first().click();
  await expect(page.getByTestId("id-check")).toContainText("hashL2Proposal recomputed here");
  await expect(page.getByTestId("set-veto").getByTestId("signature-count")).toContainText(
    "· 5 required"
  );
});

test("the freeze page lists requests from Safe with their on-chain status", async ({ page }) => {
  await page.goto("/app/freeze");
  await expect(page.getByTestId("past-freezes").getByTestId("freeze-row").first()).toContainText(
    "Soft freeze"
  );
});
